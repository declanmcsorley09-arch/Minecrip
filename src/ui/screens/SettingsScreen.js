import { Screen } from '../Screen.js';
import { h, button, clear } from '../dom.js';
import { SETTINGS_SCHEMA, DEFAULT_KEYBINDS } from '../../settings/Settings.js';

const TABS = {
  Video: ['renderDistance', 'fov', 'renderScale', 'maxFps', 'shadows', 'shadowQuality', 'clouds', 'fancyLeaves', 'viewBobbing', 'occlusionCulling'],
  Controls: ['mouseSensitivity', 'invertY'],
  Audio: ['masterVolume', 'musicVolume', 'blocksVolume', 'ambientVolume', 'mobsVolume', 'playerVolume'],
  Game: ['autosaveInterval'],
};

const KEY_LABELS = {
  forward: 'Walk Forwards',
  back: 'Walk Backwards',
  left: 'Strafe Left',
  right: 'Strafe Right',
  jump: 'Jump / Fly Up',
  sneak: 'Sneak / Fly Down',
  sprint: 'Sprint',
  inventory: 'Inventory',
  drop: 'Drop Item',
  chat: 'Open Chat',
  command: 'Open Command',
  debug: 'Debug Screen',
  hideHud: 'Hide HUD',
  fullscreen: 'Fullscreen',
};

/**
 * Formats a value for display.
 * @param {string} key
 * @param {any} value
 * @returns {string}
 */
function formatValue(key, value) {
  const s = SETTINGS_SCHEMA[key];
  if (s.percent) return `${Math.round(value * 100)}%`;
  if (key === 'maxFps') return value === 0 ? 'Unlimited' : `${value}`;
  if (key === 'autosaveInterval') return `every ${value}s`;
  if (key === 'mouseSensitivity') return `${Math.round(value * 200)}%`;
  if (key === 'renderScale') return `${Math.round(value * 100)}%`;
  if (key === 'shadowQuality') return value[0].toUpperCase() + value.slice(1);
  return `${value}${s.unit ?? ''}`;
}

/**
 * Human readable key code.
 * @param {string} code
 * @returns {string}
 */
function keyName(code) {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Control', 'Ctrl');
}

export class SettingsScreen extends Screen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {import('../../settings/Settings.js').Settings} settings
   * @param {boolean} inGame opened from the pause menu (world visible behind)
   */
  constructor(ui, settings, inGame) {
    super(ui);
    this.settings = settings;
    this.inGame = inGame;
    this.tab = 'Video';
    this.listening = null;
  }

  build() {
    this.tabs = h('div.tabs');
    this.body = h('div.settings-grid');
    this.renderTabs();
    this.renderBody();
    return h(`div.screen${this.inGame ? '.dim' : '.menu-bg'}`, {},
      h('h2', {}, 'Options'),
      h('div.settings-panel', {}, this.tabs, this.body),
      h('div.row', { style: { marginTop: '14px' } },
        button('Fullscreen', () => toggleFullscreen()),
        button('Reset Defaults', () => {
          this.settings.reset();
          this.renderBody();
        }),
        button('Done', () => this.ui.close(this)),
      ),
    );
  }

  /** @private */
  renderTabs() {
    clear(this.tabs);
    for (const name of [...Object.keys(TABS), 'Keys']) {
      const b = button(name, () => {
        this.tab = name;
        this.renderTabs();
        this.renderBody();
      }, { small: true });
      b.classList.add('tab');
      if (name === this.tab) b.classList.add('active');
      this.tabs.appendChild(b);
    }
  }

  /** @private */
  renderBody() {
    clear(this.body);
    if (this.tab === 'Keys') {
      const binds = this.settings.get('keybinds');
      for (const action of Object.keys(DEFAULT_KEYBINDS)) {
        const b = button(keyName(binds[action]), () => {
          this.listening = action;
          this.renderBody();
        });
        if (this.listening === action) {
          b.textContent = '> press a key <';
          b.classList.add('listening');
        }
        this.body.appendChild(h('div.keybind-row', {}, h('span', {}, KEY_LABELS[action] ?? action), b));
      }
      return;
    }
    for (const key of TABS[this.tab]) this.body.appendChild(this.widget(key));
  }

  /** Creates the control for one setting. @private */
  widget(key) {
    const schema = SETTINGS_SCHEMA[key];
    const value = this.settings.get(key);
    if (schema.type === 'toggle') {
      const b = button(`${schema.label}: ${value ? 'ON' : 'OFF'}`, () => {
        this.settings.set(key, !this.settings.get(key));
        b.textContent = `${schema.label}: ${this.settings.get(key) ? 'ON' : 'OFF'}`;
      }, { wide: true });
      return b;
    }
    if (schema.type === 'select') {
      const b = button(`${schema.label}: ${formatValue(key, value)}`, () => {
        const opts = schema.options;
        const next = opts[(opts.indexOf(this.settings.get(key)) + 1) % opts.length];
        this.settings.set(key, next);
        b.textContent = `${schema.label}: ${formatValue(key, next)}`;
      }, { wide: true });
      return b;
    }
    return this.slider(key, schema);
  }

  /** Draggable slider bound to a numeric setting. @private */
  slider(key, schema) {
    const fill = h('div.fill');
    const knob = h('div.knob');
    const label = h('div.label');
    const el = h('div.slider', {}, fill, knob, label);
    const render = () => {
      const v = this.settings.get(key);
      const t = (v - schema.min) / (schema.max - schema.min);
      fill.style.width = `${t * 100}%`;
      knob.style.left = `${t * 100}%`;
      label.textContent = `${schema.label}: ${formatValue(key, v)}`;
    };
    const setFromEvent = (e) => {
      const rect = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      let v = schema.min + t * (schema.max - schema.min);
      v = Math.round(v / schema.step) * schema.step;
      v = Number(Math.min(schema.max, Math.max(schema.min, v)).toFixed(4));
      this.settings.set(key, v);
      render();
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      setFromEvent(e);
      const move = (ev) => setFromEvent(ev);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        this.ui.click();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    render();
    return el;
  }

  onKey(e) {
    if (this.listening) {
      this.settings.setKeybind(this.listening, e.code);
      this.listening = null;
      this.renderBody();
      return true;
    }
    return false;
  }

  onEscape() {
    if (this.listening) {
      this.listening = null;
      this.renderBody();
      return;
    }
    this.ui.close(this);
  }
}

/** Toggles browser fullscreen. */
export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}
