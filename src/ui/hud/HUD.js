import { h, clear } from '../dom.js';

/**
 * In-game heads-up display: crosshair, hotbar, health and air, held item
 * name, chat, debug overlay (F3), damage flash and underwater tint.
 */

/**
 * Renders a tiny pixel pattern to a data URL.
 * @param {string[]} rows
 * @param {Record<string,string>} palette
 * @returns {string}
 */
function pixelIcon(rows, palette) {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = palette[ch];
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return c.toDataURL();
}

const HEART_ROWS = ['.OO.OO.', 'ORROHRO', 'ORRRRRO', 'ORRRRRO', '.ORRRO.', '..ORO..', '...O...'];
const HEART_HALF_ROWS = ['.OO.OO.', 'ORROEEO', 'ORRREEO', 'ORRREEO', '.ORREO.', '..ORO..', '...O...'];
const HEART_EMPTY_ROWS = ['.OO.OO.', 'OEEOEEO', 'OEEEEEO', 'OEEEEEO', '.OEEEO.', '..OEO..', '...O...'];
const BUBBLE_ROWS = ['..OOO..', '.OWLLO.', 'OWLLLLO', 'OLLLLLO', 'OLLLLLO', '.OLLLO.', '..OOO..'];
const BUBBLE_POP_ROWS = ['.......', '..O.O..', '.O...O.', '...L...', '.O...O.', '..O.O..', '.......'];

export class HUD {
  /**
   * @param {HTMLElement} root
   * @param {import('../../renderer/ItemIcons.js').ItemIcons} icons
   */
  constructor(root, icons) {
    this.icons = icons;
    const pal = { O: '#1a0a0a', R: '#e0231e', H: '#ff9d9d', E: '#3a2a2a', W: '#ffffff', L: '#5aa0ff' };
    this.heartFull = pixelIcon(HEART_ROWS, pal);
    this.heartHalf = pixelIcon(HEART_HALF_ROWS, pal);
    this.heartEmpty = pixelIcon(HEART_EMPTY_ROWS, pal);
    this.bubble = pixelIcon(BUBBLE_ROWS, { ...pal, O: '#0a2a6a' });
    this.bubblePop = pixelIcon(BUBBLE_POP_ROWS, { ...pal, O: '#0a2a6a' });

    this.crosshair = h('div.crosshair');
    this.hotbarSlots = [];
    this.hotbar = h('div.hotbar');
    for (let i = 0; i < 9; i++) {
      const s = h('div.slot');
      this.hotbarSlots.push({ el: s, key: '' });
      this.hotbar.appendChild(s);
    }
    this.hearts = h('div.hearts');
    this.heartEls = Array.from({ length: 10 }, () => h('div.heart'));
    this.heartEls.forEach((e) => this.hearts.appendChild(e));
    this.bubbles = h('div.bubbles');
    this.bubbleEls = Array.from({ length: 10 }, () => h('div.bubble'));
    this.bubbleEls.forEach((e) => this.bubbles.appendChild(e));
    this.status = h('div.status', {}, this.hearts, this.bubbles);
    this.toast = h('div.toast');
    this.saveIndicator = h('div.save-indicator', {}, 'Saving world…');
    this.debugLeft = h('div.debug');
    this.debugRight = h('div.debug.right');
    this.chatLog = h('div.chat');
    this.chatInput = h('input', { maxLength: 256, spellcheck: false });
    this.chatBox = h('div.chat-input', {}, this.chatInput);
    this.underwater = h('div.underwater-tint');
    this.hurtFlash = h('div.hurt-flash');
    this.root = h('div.hud', {},
      this.underwater, this.hurtFlash, this.crosshair, this.status, this.hotbar, this.toast,
      this.saveIndicator, this.debugLeft, this.debugRight, this.chatLog, this.chatBox,
    );
    this.root.style.display = 'none';
    root.appendChild(this.root);
    this.chatBox.style.pointerEvents = 'auto';
    this.chatInput.style.pointerEvents = 'auto';

    this.lastSelected = -1;
    this.lastHeldId = -1;
    this.toastTimer = 0;
    this.hurtTimer = 0;
    this.debugVisible = false;
    this.debugTimer = 0;
    this.chatOpen = false;
    this.lastHealth = 20;
    this.history = [];
    this.historyIndex = -1;
  }

  /** Shows the HUD. */
  show() {
    this.root.style.display = '';
  }

  /** Hides the HUD. */
  hide() {
    this.root.style.display = 'none';
    this.closeChat();
  }

  /** Toggles the F1 "hide HUD" mode. */
  toggleHidden() {
    this.root.classList.toggle('hidden');
  }

  /** Toggles the F3 debug overlay. */
  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debugLeft.classList.toggle('show', this.debugVisible);
    this.debugRight.classList.toggle('show', this.debugVisible);
  }

  /**
   * Shows the "saving" indicator briefly.
   */
  flashSaving() {
    this.saveIndicator.classList.add('show');
    clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.saveIndicator.classList.remove('show'), 1200);
  }

  /**
   * Adds a chat line.
   * @param {string} text
   * @param {string} [color]
   */
  addChat(text, color) {
    for (const part of String(text).split('\n')) {
      const line = h('div.line', { style: color ? { color } : {} }, part);
      this.chatLog.appendChild(line);
      setTimeout(() => line.classList.add('faded'), 10000);
    }
    while (this.chatLog.children.length > 60) this.chatLog.removeChild(this.chatLog.firstChild);
  }

  /**
   * Opens the chat input.
   * @param {string} [prefix]
   * @param {(text: string) => void} onSubmit
   * @param {() => void} onClose
   */
  openChat(prefix, onSubmit, onClose) {
    this.chatOpen = true;
    this.onChatSubmit = onSubmit;
    this.onChatClose = onClose;
    this.chatBox.classList.add('open');
    this.chatLog.classList.add('open');
    this.chatInput.value = prefix ?? '';
    this.historyIndex = this.history.length;
    // Defer focus so the opening key press is not typed into the box.
    setTimeout(() => this.chatInput.focus(), 0);
    this.chatKeyHandler = (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text) {
          this.history.push(text);
          this.onChatSubmit(text);
        }
        this.closeChat();
      } else if (e.code === 'Escape') {
        this.closeChat();
      } else if (e.code === 'ArrowUp' && this.history.length) {
        this.historyIndex = Math.max(0, this.historyIndex - 1);
        this.chatInput.value = this.history[this.historyIndex];
        e.preventDefault();
      } else if (e.code === 'ArrowDown' && this.history.length) {
        this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
        this.chatInput.value = this.history[this.historyIndex] ?? '';
        e.preventDefault();
      }
    };
    this.chatInput.addEventListener('keydown', this.chatKeyHandler);
  }

  /** Closes the chat input. */
  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.chatBox.classList.remove('open');
    this.chatLog.classList.remove('open');
    this.chatInput.removeEventListener('keydown', this.chatKeyHandler);
    this.chatInput.blur();
    const cb = this.onChatClose;
    this.onChatClose = null;
    if (cb) cb();
  }

  /**
   * Flashes the screen red.
   */
  hurt() {
    this.hurtFlash.classList.add('show');
    this.hearts.classList.add('hurt');
    clearTimeout(this.hurtTimeout);
    this.hurtTimeout = setTimeout(() => {
      this.hurtFlash.classList.remove('show');
      this.hearts.classList.remove('hurt');
    }, 150);
  }

  /**
   * Updates the HUD from game state.
   * @param {number} dt
   * @param {import('../../core/Game.js').Game} game
   */
  update(dt, game) {
    const p = game.player;
    const inv = p.inventory;
    // Hotbar.
    for (let i = 0; i < 9; i++) {
      const view = this.hotbarSlots[i];
      const s = inv.get(i);
      const key = s ? `${s.id}:${s.count}:${s.damage}` : '';
      if (key !== view.key) {
        view.key = key;
        clear(view.el);
        if (s) {
          view.el.appendChild(h('div.item-icon', { style: { backgroundImage: `url(${this.icons.url(s.id)})` } }));
          if (s.count > 1) view.el.appendChild(h('div.item-count', {}, String(s.count)));
          if (s.def?.tool && s.damage > 0) {
            const f = s.durabilityFraction;
            view.el.appendChild(h('div.durability', {}, h('div', { style: { width: `${f * 100}%`, background: `hsl(${f * 120},90%,45%)` } })));
          }
        }
      }
      view.el.classList.toggle('selected', i === inv.selected);
    }
    // Held item name toast.
    const held = inv.held;
    const heldId = held ? held.id : 0;
    if (inv.selected !== this.lastSelected || heldId !== this.lastHeldId) {
      if (held && (inv.selected !== this.lastSelected || heldId !== this.lastHeldId)) {
        this.toast.textContent = held.def?.displayName ?? '';
        this.toast.classList.add('show');
        this.toastTimer = 2;
      }
      this.lastSelected = inv.selected;
      this.lastHeldId = heldId;
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }

    // Health and air (survival only).
    const survival = p.gameMode === 'survival';
    this.status.style.display = survival ? '' : 'none';
    if (survival) {
      if (p.health < this.lastHealth) this.hurt();
      this.lastHealth = p.health;
      for (let i = 0; i < 10; i++) {
        const v = p.health - i * 2;
        const url = v >= 2 ? this.heartFull : v === 1 ? this.heartHalf : this.heartEmpty;
        const el = this.heartEls[i];
        if (el.dataset.url !== url) {
          el.dataset.url = url;
          el.style.backgroundImage = `url(${url})`;
        }
      }
      this.hearts.classList.toggle('low', p.health <= 4 && p.health > 0);
      const showAir = p.eyeInWater || p.air < p.maxAir;
      this.bubbles.style.display = showAir ? '' : 'none';
      if (showAir) {
        const bubbles = (p.air / p.maxAir) * 10;
        for (let i = 0; i < 10; i++) {
          const el = this.bubbleEls[9 - i];
          const state = bubbles >= i + 1 ? 'full' : bubbles > i ? 'pop' : 'none';
          if (el.dataset.state !== state) {
            el.dataset.state = state;
            el.style.backgroundImage = state === 'none' ? 'none' : `url(${state === 'full' ? this.bubble : this.bubblePop})`;
          }
        }
      }
    }
    this.underwater.classList.toggle('show', p.eyeInWater);
    this.crosshair.style.display = p.dead ? 'none' : '';

    // Debug overlay (refreshed a few times per second).
    if (this.debugVisible) {
      this.debugTimer -= dt;
      if (this.debugTimer <= 0) {
        this.debugTimer = 0.2;
        this.renderDebug(game.debugInfo());
      }
    }
  }

  /** @private */
  renderDebug(d) {
    const left = [
      `Minecrip 1.0 (${d.fps} fps, ${d.frameTime.toFixed(1)} ms)`,
      `XYZ: ${d.x.toFixed(3)} / ${d.y.toFixed(3)} / ${d.z.toFixed(3)}`,
      `Block: ${d.block.join(' ')}`,
      `Chunk: ${d.chunk.join(' ')}  (section ${d.chunk[1]})`,
      `Facing: ${d.facing}`,
      `Biome: ${d.biome}`,
      `Light: ${d.skyLight} sky, ${d.blockLight} block`,
      `Seed: ${d.seed}`,
      `Time: ${d.time} (day ${d.day})  Weather: ${d.weather}`,
      `Mode: ${d.gameMode}`,
      d.target ? `Looking at: ${d.target}` : '',
    ].filter(Boolean);
    const right = [
      `Render distance: ${d.renderDistance} chunks`,
      `Chunks: ${d.chunks} loaded, ${d.pendingChunks} pending`,
      `Sections: ${d.sections}, meshes ${d.meshes} (${d.visibleMeshes} visible)`,
      `Mesh queue: ${d.pendingMeshes}`,
      `Draw calls: ${d.drawCalls}  Triangles: ${d.triangles.toLocaleString()}`,
      `Entities: ${d.entities}`,
      d.memory !== null ? `JS heap: ${d.memory} MB` : 'JS heap: n/a',
      `Chunk data: ${d.chunkMemory} MB`,
      'Frame breakdown (ms):',
      ...d.profile.map(([name, ms]) => `${name}: ${ms.toFixed(2)}`),
    ];
    clear(this.debugLeft);
    clear(this.debugRight);
    for (const l of left) this.debugLeft.appendChild(h('div', {}, l));
    for (const l of right) this.debugRight.appendChild(h('div', {}, l));
  }
}
