import { Screen } from '../Screen.js';
import { h, clear } from '../dom.js';
import { clickSlot, shiftClick, collectToCursor, distribute } from '../../inventory/SlotActions.js';

/**
 * Base class for slot-based screens (inventory, crafting table, furnace,
 * creative inventory). Implements the mouse interaction model:
 * click / right click, shift-click quick move, double-click collect,
 * drag to distribute, number keys to swap with the hotbar, Q to drop,
 * plus the floating cursor stack and item tooltips.
 */
export class ContainerScreen extends Screen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {import('../../core/Game.js').Game} game
   */
  constructor(ui, game) {
    super(ui);
    this.game = game;
    this.overlay = true;
    /** @type {import('../../inventory/SlotActions.js').Cursor} */
    this.cursor = { stack: null };
    /** @type {{el: HTMLElement, slot: object, rendered: string}[]} */
    this.views = [];
    this.drag = null;
    this.hover = null;
    this.lastClick = { slot: null, time: 0 };
    this.mouse = { x: 0, y: 0 };
  }

  /** Inventory of the local player. */
  get inventory() {
    return this.game.player.inventory;
  }

  /**
   * Builds the screen specific content.
   * @returns {HTMLElement}
   */
  buildContent() {
    throw new Error('ContainerScreen.buildContent not implemented');
  }

  build() {
    this.cursorEl = h('div.cursor-stack');
    this.tooltip = h('div.tooltip', { style: { display: 'none' } });
    const root = h('div.container-screen', {
      onMousemove: (e) => this.onMouseMove(e),
      onMouseup: (e) => this.onMouseUp(e),
      onContextmenu: (e) => e.preventDefault(),
      onMousedown: (e) => {
        if (e.target === root) this.onOutsideClick(e);
      },
    }, this.buildContent(), this.cursorEl, this.tooltip);
    this.refresh();
    return root;
  }

  /**
   * Creates an element bound to a slot adapter.
   * @param {import('../../inventory/SlotActions.js').Slot} slot
   * @param {{big?: boolean, className?: string}} [opts]
   * @returns {HTMLElement}
   */
  slotEl(slot, opts = {}) {
    const el = h(`div.slot-cell${opts.big ? '.big' : ''}${opts.className ? `.${opts.className}` : ''}`, {
      onMousedown: (e) => this.onSlotDown(e, slot),
      onMouseenter: () => {
        this.hover = slot;
        if (this.drag && !this.drag.slots.includes(slot)) this.drag.slots.push(slot);
        this.updateTooltip();
      },
      onMouseleave: () => {
        if (this.hover === slot) this.hover = null;
        this.updateTooltip();
      },
    });
    this.views.push({ el, slot, rendered: '' });
    return el;
  }

  /**
   * Adapters for the player's hotbar (0-8) and main inventory (9-35).
   * @returns {{hotbar: object[], main: object[]}}
   */
  playerSlots() {
    const inv = this.inventory;
    const adapter = (i) => ({ index: i, get: () => inv.get(i), set: (s) => inv.set(i, s) });
    return {
      hotbar: Array.from({ length: 9 }, (_, i) => adapter(i)),
      main: Array.from({ length: 27 }, (_, i) => adapter(9 + i)),
    };
  }

  /**
   * Standard player inventory section (3 rows + hotbar).
   * @returns {HTMLElement}
   */
  playerSection() {
    const { hotbar, main } = this.playerSlots();
    this.hotbarSlots = hotbar;
    this.mainSlots = main;
    return h('div', {},
      h('h3', {}, 'Inventory'),
      h('div.slots', { style: { gridTemplateColumns: 'repeat(9, auto)' } }, main.map((s) => this.slotEl(s))),
      h('div.slots.hotbar-row', { style: { gridTemplateColumns: 'repeat(9, auto)' } }, hotbar.map((s) => this.slotEl(s))),
    );
  }

  /**
   * Where shift-clicking a slot sends its items.
   * @param {object} slot
   * @returns {object[]}
   */
  shiftTargets(slot) {
    if (this.hotbarSlots?.includes(slot)) return this.mainSlots;
    if (this.mainSlots?.includes(slot)) return this.hotbarSlots;
    return [...(this.mainSlots ?? []), ...(this.hotbarSlots ?? [])];
  }

  /** @private */
  onSlotDown(e, slot) {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0 && e.button !== 2) return;
    if (e.shiftKey) {
      this.shiftClickSlot(slot);
      this.changed();
      return;
    }
    const now = performance.now();
    if (e.button === 0 && this.lastClick.slot === slot && now - this.lastClick.time < 300 && this.cursor.stack) {
      collectToCursor(this.views.map((v) => v.slot).filter((s) => !s.palette), this.cursor);
      this.lastClick.slot = null;
      this.changed();
      return;
    }
    this.lastClick = { slot, time: now };
    if (this.cursor.stack && !slot.output && !slot.palette) {
      this.drag = { button: e.button, slots: [slot] };
      return;
    }
    this.handleClick(slot, e.button);
  }

  /**
   * Quick-moves a slot's contents (overridden for palette slots).
   * @protected
   * @param {object} slot
   */
  shiftClickSlot(slot) {
    shiftClick(slot, this.shiftTargets(slot));
  }

  /**
   * Performs a click on a slot (overridden for palette slots).
   * @protected
   */
  handleClick(slot, button) {
    clickSlot(slot, this.cursor, button);
    this.changed();
  }

  /** @private */
  onMouseUp() {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.slots.length > 1) {
      distribute(d.slots, this.cursor, d.button);
      this.changed();
    } else {
      this.handleClick(d.slots[0], d.button);
    }
  }

  /** Clicking outside the panel drops the cursor stack. @private */
  onOutsideClick(e) {
    if (!this.cursor.stack) return;
    const s = this.cursor.stack;
    const drop = e.button === 2 ? s.split(1) : s.split(s.count);
    if (s.count <= 0) this.cursor.stack = null;
    this.dropStack(drop);
    this.changed();
  }

  /**
   * Throws a stack out in front of the player.
   * @param {import('../../inventory/ItemStack.js').ItemStack} stack
   */
  dropStack(stack) {
    const cam = this.game.renderer.camera;
    const dir = this.game.lookDir;
    this.game.client.dropItem(stack.toJSON(), { x: cam.position.x, y: cam.position.y - 0.3, z: cam.position.z }, { x: dir.x * 4, y: dir.y * 4 + 1.5, z: dir.z * 4 });
  }

  /** @private */
  onMouseMove(e) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.cursorEl.style.left = `${e.clientX}px`;
    this.cursorEl.style.top = `${e.clientY}px`;
    this.tooltip.style.left = `${e.clientX + 16}px`;
    this.tooltip.style.top = `${e.clientY - 28}px`;
  }

  /** @private */
  updateTooltip() {
    const s = this.hover?.get();
    if (!s || this.cursor.stack) {
      this.tooltip.style.display = 'none';
      return;
    }
    clear(this.tooltip);
    const def = s.def;
    this.tooltip.appendChild(h('div', {}, def?.displayName ?? 'Unknown'));
    if (def?.tool) this.tooltip.appendChild(h('div.sub', {}, `Durability: ${def.tool.durability - s.damage} / ${def.tool.durability}`));
    if (def?.food) this.tooltip.appendChild(h('div.sub', {}, `Restores ${def.food.heal / 2} ♥`));
    if (def?.fuel) this.tooltip.appendChild(h('div.sub', {}, `Fuel: ${def.fuel}s`));
    this.tooltip.style.display = 'block';
  }

  /** Called after any mutation. */
  changed() {
    this.refresh();
    this.updateTooltip();
  }

  /**
   * Renders an item stack into an element.
   * @param {HTMLElement} el
   * @param {import('../../inventory/ItemStack.js').ItemStack|null} s
   */
  renderStack(el, s) {
    clear(el);
    if (!s) return;
    el.appendChild(h('div.item-icon', { style: { backgroundImage: `url(${this.ui.icons.url(s.id)})` } }));
    if (s.count > 1) el.appendChild(h('div.item-count', {}, String(s.count)));
    const tool = s.def?.tool;
    if (tool && s.damage > 0) {
      const f = s.durabilityFraction;
      el.appendChild(h('div.durability', {}, h('div', { style: { width: `${f * 100}%`, background: `hsl(${f * 120}, 90%, 45%)` } })));
    }
  }

  /** Re-renders slots whose contents changed and the cursor stack. */
  refresh() {
    for (const v of this.views) {
      const s = v.slot.get();
      const key = s ? `${s.id}:${s.count}:${s.damage}` : '';
      if (key === v.rendered) continue;
      v.rendered = key;
      // Keep non-item children (e.g. trash icon) by rendering into a dedicated layer.
      this.renderStack(v.el, s);
    }
    const c = this.cursor.stack;
    const ck = c ? `${c.id}:${c.count}:${c.damage}` : '';
    if (ck !== this.cursorKey) {
      this.cursorKey = ck;
      this.renderStack(this.cursorEl, c);
    }
  }

  onKey(e) {
    const binds = this.ui.settings.get('keybinds');
    if (e.code === binds.inventory) {
      this.ui.close(this);
      return true;
    }
    if (this.hover && /^Digit[1-9]$/.test(e.code)) {
      const i = Number(e.code.slice(5)) - 1;
      const inv = this.inventory;
      const a = this.hover.get();
      const b = inv.get(i);
      if (this.hover.output || this.hover.palette) return true;
      if (b && this.hover.accepts && !this.hover.accepts(b)) return true;
      this.hover.set(b);
      inv.set(i, a);
      this.changed();
      return true;
    }
    if (this.hover && e.code === binds.drop) {
      const s = this.hover.get();
      if (s && !this.hover.output && !this.hover.palette) {
        const drop = e.ctrlKey ? s.split(s.count) : s.split(1);
        this.hover.set(s.count > 0 ? s : null);
        this.dropStack(drop);
        this.changed();
      }
      return true;
    }
    return false;
  }

  update() {
    this.refresh();
  }

  onClose() {
    // Return the cursor stack to the inventory (drop what does not fit).
    if (this.cursor.stack) {
      const left = this.inventory.add(this.cursor.stack);
      if (left > 0) {
        this.cursor.stack.count = left;
        this.dropStack(this.cursor.stack);
      }
      this.cursor.stack = null;
    }
    this.returnItems();
    this.game.emit('containerClosed');
  }

  /** Hook for returning crafting grid contents on close. @protected */
  returnItems() {}

  /**
   * Gives items back to the player or drops them.
   * @protected
   * @param {import('../../inventory/ItemStack.js').ItemStack[]} stacks
   */
  giveBack(stacks) {
    for (const s of stacks) {
      const left = this.inventory.add(s);
      if (left > 0) {
        s.count = left;
        this.dropStack(s);
      }
    }
  }
}
