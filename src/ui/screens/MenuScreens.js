import { Screen } from '../Screen.js';
import { h, button, clear, formatDate } from '../dom.js';
import { itemRegistry } from '../../items/index.js';

/**
 * Title, world selection, world creation, confirmation and loading screens.
 * @module ui/screens/MenuScreens
 */

const SPLASHES = [
  'Now with procedural everything!',
  'Greedy meshing!',
  'Seeded worlds!',
  'Cave culling!',
  '100% original pixels!',
  'Also try digging straight down!',
  'Clouds drift!',
  'Written in JavaScript!',
  'Sheep included!',
  'Mind the creepers... wait, no creepers!',
];

export class MainMenuScreen extends Screen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {import('../../core/App.js').App} app
   */
  constructor(ui, app) {
    super(ui);
    this.app = app;
  }

  build() {
    const splash = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
    return h('div.screen.menu-bg.main-menu', {},
      h('div.title-wrap', {}, h('div.title-logo', {}, 'MINECRIP'), h('div.title-splash', {}, splash)),
      h('div.column', {},
        button('Singleplayer', () => this.ui.open(new WorldSelectScreen(this.ui, this.app)), { wide: true }),
        button('Settings', () => this.app.openSettings(), { wide: true }),
      ),
      h('div.footer-note.left', {}, 'Minecrip 1.0 — Three.js voxel sandbox'),
      h('div.footer-note.right', {}, 'All art & audio procedurally generated'),
    );
  }

  onEscape() {}
}

export class WorldSelectScreen extends Screen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {import('../../core/App.js').App} app
   */
  constructor(ui, app) {
    super(ui);
    this.app = app;
    this.selected = null;
    this.worlds = [];
  }

  build() {
    this.list = h('div.world-list', {}, h('div.empty-note', {}, 'Loading worlds…'));
    this.playBtn = button('Play Selected World', () => this.play(), { disabled: true });
    this.deleteBtn = button('Delete', () => this.remove(), { disabled: true, danger: true });
    return h('div.screen.menu-bg', {},
      h('h2', {}, 'Select World'),
      this.list,
      h('div.row', {}, this.playBtn, button('Create New World', () => this.ui.open(new CreateWorldScreen(this.ui, this.app)))),
      h('div.row', {}, this.deleteBtn, button('Back', () => this.ui.close(this))),
    );
  }

  onOpen() {
    this.refresh();
  }

  /** Reloads the world list. */
  async refresh() {
    try {
      this.worlds = await this.app.listWorlds();
    } catch (e) {
      console.error(e);
      this.worlds = [];
    }
    this.render();
  }

  /** @private */
  render() {
    clear(this.list);
    if (this.worlds.length === 0) {
      this.list.appendChild(h('div.empty-note', {}, 'No worlds yet. Create one to start playing!'));
    }
    const thumb = this.ui.icons.url(itemRegistry.ids.grass_block);
    for (const w of this.worlds) {
      const el = h('div.world-item', {
        onClick: () => this.select(w.id),
        onDblclick: () => {
          this.select(w.id);
          this.play();
        },
      },
      h('div.thumb', { style: { backgroundImage: `url(${thumb})` } }),
      h('div', {},
        h('div.name', {}, w.name),
        h('div.meta', {}, `${w.gameMode === 'creative' ? 'Creative' : 'Survival'} · Seed: ${w.seedText ?? w.seed}`),
        h('div.meta', {}, `Last played ${formatDate(w.lastPlayed)}`),
      ));
      el.dataset.id = w.id;
      if (w.id === this.selected) el.classList.add('selected');
      this.list.appendChild(el);
    }
    this.playBtn.disabled = !this.selected;
    this.deleteBtn.disabled = !this.selected;
  }

  /** @private */
  select(id) {
    this.selected = id;
    this.render();
  }

  /** @private */
  play() {
    const w = this.worlds.find((x) => x.id === this.selected);
    if (w) this.app.playWorld(w);
  }

  /** @private */
  remove() {
    const w = this.worlds.find((x) => x.id === this.selected);
    if (!w) return;
    this.ui.open(new ConfirmScreen(this.ui, `Delete "${w.name}"?`, 'This world will be lost forever!', async () => {
      await this.app.deleteWorld(w.id);
      this.selected = null;
      this.refresh();
    }));
  }
}

export class CreateWorldScreen extends Screen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {import('../../core/App.js').App} app
   */
  constructor(ui, app) {
    super(ui);
    this.app = app;
    this.mode = 'survival';
  }

  build() {
    this.nameInput = h('input.text-input', { value: 'New World', maxLength: 32 });
    this.seedInput = h('input.text-input', { placeholder: 'Leave blank for a random seed', maxLength: 32 });
    this.modeBtn = button('Game Mode: Survival', () => {
      this.mode = this.mode === 'survival' ? 'creative' : 'survival';
      this.modeBtn.textContent = `Game Mode: ${this.mode === 'survival' ? 'Survival' : 'Creative'}`;
      this.modeHint.textContent = this.mode === 'survival' ? 'Gather resources, craft tools, survive the night.' : 'Unlimited blocks, flight and instant breaking.';
    }, { wide: true });
    this.modeHint = h('div.hint', {}, 'Gather resources, craft tools, survive the night.');
    return h('div.screen.menu-bg', {},
      h('h2', {}, 'Create New World'),
      h('div.column', {},
        h('div.field', {}, h('label', {}, 'World Name'), this.nameInput),
        h('div.field', {}, h('label', {}, 'Seed'), this.seedInput),
        this.modeBtn,
        this.modeHint,
        h('div.row', {}, button('Create New World', () => this.create()), button('Cancel', () => this.ui.close(this))),
      ),
    );
  }

  onOpen() {
    this.nameInput.focus();
    this.nameInput.select();
  }

  onKey(e) {
    if (e.code === 'Enter') {
      this.create();
      return true;
    }
    return false;
  }

  /** @private */
  async create() {
    const world = await this.app.createWorld({ name: this.nameInput.value, seed: this.seedInput.value, gameMode: this.mode });
    this.app.playWorld(world);
  }
}

export class ConfirmScreen extends Screen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {string} title
   * @param {string} message
   * @param {() => void} onConfirm
   */
  constructor(ui, title, message, onConfirm) {
    super(ui);
    this.title = title;
    this.message = message;
    this.onConfirm = onConfirm;
  }

  build() {
    return h('div.screen.menu-bg', {},
      h('h2', {}, this.title),
      h('div', { style: { marginBottom: '16px', textShadow: '2px 2px 0 #222' } }, this.message),
      h('div.row', {},
        button('Yes', () => {
          this.ui.close(this);
          this.onConfirm();
        }, { danger: true }),
        button('Cancel', () => this.ui.close(this)),
      ),
    );
  }
}

export class LoadingScreen extends Screen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {string} title
   */
  constructor(ui, title) {
    super(ui);
    this.title = title;
  }

  build() {
    this.bar = h('div.bar');
    this.status = h('div', { style: { textShadow: '2px 2px 0 #222' } }, 'Preparing…');
    return h('div.screen.menu-bg', {}, h('h2', {}, this.title), this.status, h('div.progress', {}, this.bar));
  }

  /**
   * @param {number} progress 0..1
   * @param {string} [text]
   */
  setProgress(progress, text) {
    this.bar.style.width = `${Math.round(progress * 100)}%`;
    if (text) this.status.textContent = text;
  }

  onEscape() {}
}
