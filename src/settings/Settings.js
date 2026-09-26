import { EventEmitter } from '../utils/EventEmitter.js';

/**
 * User settings with defaults, validation and change notification.
 * Persistence is delegated to an adapter (IndexedDB in the browser).
 */

/** Default key bindings (KeyboardEvent.code values). */
export const DEFAULT_KEYBINDS = Object.freeze({
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sneak: 'ShiftLeft',
  sprint: 'ControlLeft',
  inventory: 'KeyE',
  drop: 'KeyQ',
  chat: 'KeyT',
  command: 'Slash',
  debug: 'F3',
  hideHud: 'F1',
  fullscreen: 'F11',
});

/** Human readable setting descriptions used by the settings screens. */
export const SETTINGS_SCHEMA = {
  renderDistance: { type: 'range', min: 2, max: 16, step: 1, label: 'Render Distance', unit: ' chunks' },
  fov: { type: 'range', min: 50, max: 110, step: 1, label: 'Field of View', unit: '°' },
  renderScale: { type: 'range', min: 0.5, max: 1, step: 0.05, label: 'Render Scale', unit: 'x' },
  shadows: { type: 'toggle', label: 'Shadows' },
  shadowQuality: { type: 'select', label: 'Shadow Quality', options: ['low', 'medium', 'high'] },
  clouds: { type: 'toggle', label: 'Clouds' },
  fancyLeaves: { type: 'toggle', label: 'Fancy Leaves' },
  viewBobbing: { type: 'toggle', label: 'View Bobbing' },
  occlusionCulling: { type: 'toggle', label: 'Occlusion Culling' },
  maxFps: { type: 'select', label: 'Max FPS', options: [0, 30, 60, 120, 144] },
  mouseSensitivity: { type: 'range', min: 0.05, max: 1, step: 0.01, label: 'Mouse Sensitivity' },
  invertY: { type: 'toggle', label: 'Invert Mouse' },
  masterVolume: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Master Volume', percent: true },
  musicVolume: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Music', percent: true },
  blocksVolume: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Blocks', percent: true },
  ambientVolume: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Ambient & Weather', percent: true },
  mobsVolume: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Creatures', percent: true },
  playerVolume: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Player', percent: true },
  autosaveInterval: { type: 'select', label: 'Autosave', options: [30, 60, 120, 300] },
};

export const DEFAULT_SETTINGS = Object.freeze({
  renderDistance: 8,
  fov: 75,
  renderScale: 1,
  shadows: true,
  shadowQuality: 'medium',
  clouds: true,
  fancyLeaves: true,
  viewBobbing: true,
  occlusionCulling: true,
  maxFps: 0,
  mouseSensitivity: 0.45,
  invertY: false,
  masterVolume: 0.8,
  musicVolume: 0.5,
  blocksVolume: 1,
  ambientVolume: 0.8,
  mobsVolume: 1,
  playerVolume: 1,
  autosaveInterval: 60,
  keybinds: DEFAULT_KEYBINDS,
});

export class Settings extends EventEmitter {
  /**
   * @param {{load: () => Promise<object|null>, save: (data: object) => Promise<void>}|null} [adapter]
   */
  constructor(adapter = null) {
    super();
    this.adapter = adapter;
    /** @type {Record<string, any>} */
    this.values = structuredClone(DEFAULT_SETTINGS);
    this.saveTimer = null;
  }

  /** Loads persisted values (unknown keys are ignored). */
  async load() {
    if (!this.adapter) return;
    const data = await this.adapter.load();
    if (!data) return;
    for (const [key, value] of Object.entries(data)) {
      if (key === 'keybinds' && value && typeof value === 'object') {
        this.values.keybinds = { ...DEFAULT_KEYBINDS, ...value };
      } else if (key in DEFAULT_SETTINGS && this.validate(key, value)) {
        this.values[key] = value;
      }
    }
  }

  /** @private */
  validate(key, value) {
    const def = DEFAULT_SETTINGS[key];
    if (typeof def !== typeof value) return false;
    const schema = SETTINGS_SCHEMA[key];
    if (schema?.type === 'range') return value >= schema.min && value <= schema.max;
    if (schema?.type === 'select') return schema.options.includes(value);
    return true;
  }

  /**
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    return this.values[key];
  }

  /**
   * Updates a value, notifies listeners and schedules persistence.
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    if (this.values[key] === value) return;
    if (key !== 'keybinds' && !this.validate(key, value)) return;
    this.values[key] = value;
    this.emit('change', key, value);
    this.scheduleSave();
  }

  /**
   * Rebinds an action.
   * @param {string} action
   * @param {string} code KeyboardEvent.code
   */
  setKeybind(action, code) {
    this.values.keybinds = { ...this.values.keybinds, [action]: code };
    this.emit('change', 'keybinds', this.values.keybinds);
    this.scheduleSave();
  }

  /** Restores defaults. */
  reset() {
    this.values = structuredClone(DEFAULT_SETTINGS);
    for (const key of Object.keys(this.values)) this.emit('change', key, this.values[key]);
    this.scheduleSave();
  }

  /** @private */
  scheduleSave() {
    if (!this.adapter) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.adapter.save(structuredClone(this.values)).catch((e) => console.error('Failed to save settings', e));
    }, 300);
  }

  /** Persists immediately. */
  async flush() {
    clearTimeout(this.saveTimer);
    if (this.adapter) await this.adapter.save(structuredClone(this.values));
  }
}
