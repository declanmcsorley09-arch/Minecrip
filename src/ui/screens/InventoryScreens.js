import { ContainerScreen } from './ContainerScreen.js';
import { h, button, clear } from '../dom.js';
import { CraftingGrid } from '../../inventory/CraftingGrid.js';
import { ItemStack } from '../../inventory/ItemStack.js';
import { insert } from '../../inventory/SlotActions.js';
import { itemRegistry } from '../../items/index.js';
import { blockRegistry } from '../../blocks/index.js';
import { FurnaceState, COOK_TIME, smeltResult, fuelValue } from '../../crafting/Furnace.js';

/**
 * Player inventory, crafting table, furnace and creative inventory screens.
 * @module ui/screens/InventoryScreens
 */

/** Survival inventory with a 2×2 crafting grid. */
export class InventoryScreen extends ContainerScreen {
  constructor(ui, game) {
    super(ui, game);
    this.grid = new CraftingGrid(2);
  }

  buildContent() {
    this.gridSlots = this.grid.inputSlots();
    this.output = this.grid.outputSlot();
    return h('div.panel.inv-layout', {},
      h('div.inv-top', {},
        h('div', {},
          h('h3', {}, 'Crafting'),
          h('div.slots', { style: { gridTemplateColumns: 'repeat(2, auto)' } }, this.gridSlots.map((s) => this.slotEl(s))),
        ),
        h('div.craft-arrow'),
        this.slotEl(this.output, { big: true }),
      ),
      this.playerSection(),
    );
  }

  shiftTargets(slot) {
    if (slot === this.output || this.gridSlots.includes(slot)) return [...this.mainSlots, ...this.hotbarSlots];
    return super.shiftTargets(slot);
  }

  returnItems() {
    this.giveBack(this.grid.drain());
  }
}

/** Crafting table with a 3×3 grid. */
export class CraftingTableScreen extends ContainerScreen {
  constructor(ui, game) {
    super(ui, game);
    this.grid = new CraftingGrid(3);
  }

  buildContent() {
    this.gridSlots = this.grid.inputSlots();
    this.output = this.grid.outputSlot();
    return h('div.panel.inv-layout', {},
      h('h3', {}, 'Crafting Table'),
      h('div.inv-top', {},
        h('div.slots', { style: { gridTemplateColumns: 'repeat(3, auto)' } }, this.gridSlots.map((s) => this.slotEl(s))),
        h('div.craft-arrow'),
        this.slotEl(this.output, { big: true }),
      ),
      this.playerSection(),
    );
  }

  shiftTargets(slot) {
    if (slot === this.output || this.gridSlots.includes(slot)) return [...this.mainSlots, ...this.hotbarSlots];
    return super.shiftTargets(slot);
  }

  returnItems() {
    this.giveBack(this.grid.drain());
  }
}

/** Furnace UI bound to a furnace block entity. */
export class FurnaceScreen extends ContainerScreen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {import('../../core/Game.js').Game} game
   * @param {{x:number,y:number,z:number}} pos furnace position
   */
  constructor(ui, game, pos) {
    super(ui, game);
    this.pos = pos;
    let be = game.world.getBlockEntity(pos.x, pos.y, pos.z);
    if (!(be instanceof FurnaceState)) {
      be = new FurnaceState();
      game.world.setBlockEntity(pos.x, pos.y, pos.z, be);
    }
    this.furnace = be;
  }

  buildContent() {
    const f = this.furnace;
    const markDirty = () => {
      const c = this.game.world.getChunk(this.pos.x >> 4, this.pos.z >> 4);
      if (c) c.dirty = true;
    };
    this.inputSlot = { get: () => f.input, set: (s) => { f.input = s; markDirty(); } };
    this.fuelSlot = { get: () => f.fuel, set: (s) => { f.fuel = s; markDirty(); }, accepts: (s) => fuelValue(s.id) > 0 };
    this.outputSlot = {
      output: true,
      get: () => f.output,
      set: (s) => { f.output = s; markDirty(); },
      take: () => {
        const out = f.output;
        f.output = null;
        markDirty();
        return out;
      },
    };
    this.flameFill = h('div.fill');
    this.arrowFill = h('div.progress-fill');
    return h('div.panel.inv-layout', {},
      h('h3', {}, 'Furnace'),
      h('div.inv-top', {},
        h('div', {}, this.slotEl(this.inputSlot), h('div.flame', {}, this.flameFill), this.slotEl(this.fuelSlot)),
        h('div.craft-arrow', {}, this.arrowFill),
        this.slotEl(this.outputSlot, { big: true }),
      ),
      this.playerSection(),
    );
  }

  shiftTargets(slot) {
    if (slot === this.inputSlot || slot === this.fuelSlot || slot === this.outputSlot) return [...this.mainSlots, ...this.hotbarSlots];
    const s = slot.get();
    if (s && smeltResult(s.id)) return [this.inputSlot];
    if (s && fuelValue(s.id) > 0) return [this.fuelSlot];
    return super.shiftTargets(slot);
  }

  update(dt) {
    super.update(dt);
    const w = this.game.world;
    const def = blockRegistry.get(w.getBlock(this.pos.x, this.pos.y, this.pos.z));
    if (def.interaction !== 'furnace' || w.getBlockEntity(this.pos.x, this.pos.y, this.pos.z) !== this.furnace) {
      this.ui.close(this);
      return;
    }
    const f = this.furnace;
    const burn = f.burnTotal > 0 ? f.burnTime / f.burnTotal : 0;
    this.flameFill.style.height = `${Math.round(burn * 100)}%`;
    this.arrowFill.style.width = `${Math.round((f.cookTime / COOK_TIME) * 26)}px`;
  }
}

const CREATIVE_TABS = {
  All: () => true,
  Blocks: (item) => item.category === 'blocks',
  Tools: (item) => item.category === 'tools',
  Food: (item) => item.category === 'food',
  Materials: (item) => item.category === 'materials',
};

/** Creative inventory: every item available in unlimited quantity. */
export class CreativeScreen extends ContainerScreen {
  constructor(ui, game) {
    super(ui, game);
    this.tab = 'All';
    this.query = '';
  }

  buildContent() {
    this.tabs = h('div.creative-tabs');
    this.search = h('input.creative-search', {
      placeholder: 'Search items…',
      onInput: () => {
        this.query = this.search.value.toLowerCase();
        this.renderPalette();
      },
      onKeydown: (e) => e.stopPropagation(),
    });
    this.palette = h('div.creative-grid');
    const { hotbar } = this.playerSlots();
    this.hotbarSlots = hotbar;
    this.mainSlots = this.playerSlots().main;
    this.trash = {
      palette: true,
      get: () => null,
      set: () => {},
    };
    this.renderTabs();
    this.renderPalette();
    return h('div.panel', {},
      this.tabs,
      this.search,
      this.palette,
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-end', marginTop: '8px' } },
        h('div', {}, h('h3', {}, 'Hotbar'), h('div.slots', { style: { gridTemplateColumns: 'repeat(9, auto)' } }, hotbar.map((s) => this.slotEl(s)))),
        this.slotEl(this.trash, { className: 'trash-slot' }),
      ),
    );
  }

  /** @private */
  renderTabs() {
    clear(this.tabs);
    for (const name of [...Object.keys(CREATIVE_TABS), 'Inventory']) {
      const b = button(name, () => {
        this.tab = name;
        this.renderTabs();
        this.renderPalette();
      }, { small: true });
      if (name === this.tab) b.classList.add('active');
      this.tabs.appendChild(b);
    }
  }

  /** @private */
  renderPalette() {
    // Drop views belonging to the previous palette.
    const paletteEls = new Set(this.palette.children);
    this.views = this.views.filter((v) => !paletteEls.has(v.el));
    clear(this.palette);
    if (this.tab === 'Inventory') {
      for (const s of this.mainSlots) this.palette.appendChild(this.slotEl(s));
      this.refresh();
      return;
    }
    const filter = CREATIVE_TABS[this.tab];
    for (const item of itemRegistry.all()) {
      if (!filter(item)) continue;
      if (this.query && !item.displayName.toLowerCase().includes(this.query)) continue;
      const stack = new ItemStack(item.id, 1);
      const slot = { palette: true, item, get: () => stack, set: () => {} };
      const el = this.slotEl(slot);
      this.palette.appendChild(el);
    }
    this.refresh();
  }

  handleClick(slot, button) {
    if (slot === this.trash) {
      this.cursor.stack = null;
      this.changed();
      return;
    }
    if (slot.palette) {
      if (this.cursor.stack) this.cursor.stack = null;
      else this.cursor.stack = new ItemStack(slot.item.id, button === 2 ? 1 : slot.item.maxStack);
      this.changed();
      return;
    }
    super.handleClick(slot, button);
  }

  shiftClickSlot(slot) {
    if (slot === this.trash) return;
    if (slot.palette) {
      insert(this.tab === 'Inventory' ? this.mainSlots : this.hotbarSlots, new ItemStack(slot.item.id, slot.item.maxStack));
      return;
    }
    super.shiftClickSlot(slot);
  }
}
