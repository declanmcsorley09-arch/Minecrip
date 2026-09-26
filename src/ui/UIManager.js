import { EventEmitter } from '../utils/EventEmitter.js';

/**
 * Stack of DOM screens (menus, container UIs) on top of the canvas.
 * Routes keyboard input to the top screen and plays UI click sounds.
 *
 * Events: `change` (top screen or null) whenever the stack changes.
 */
export class UIManager extends EventEmitter {
  /**
   * @param {HTMLElement} root container element
   * @param {object} deps
   * @param {import('../settings/Settings.js').Settings} deps.settings
   * @param {import('../renderer/ItemIcons.js').ItemIcons} deps.icons
   * @param {import('../audio/AudioEngine.js').AudioEngine} deps.audio
   * @param {string} deps.menuBackground CSS url() for menu backgrounds
   */
  constructor(root, { settings, icons, audio, menuBackground }) {
    super();
    this.root = root;
    this.settings = settings;
    this.icons = icons;
    this.audio = audio;
    this.menuBackground = menuBackground;
    /** @type {import('./Screen.js').Screen[]} */
    this.stack = [];
    this.onKeyDown = (e) => {
      const top = this.top;
      if (!top) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        top.onEscape();
        return;
      }
      if (top.onKey(e)) e.preventDefault();
    };
    this.onClick = (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('.btn')) this.click();
    };
    window.addEventListener('keydown', this.onKeyDown);
    root.addEventListener('click', this.onClick);
  }

  /** The top-most screen or null. */
  get top() {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Whether any screen is open. */
  get hasScreen() {
    return this.stack.length > 0;
  }

  /**
   * Opens a screen on top of the stack.
   * @param {import('./Screen.js').Screen} screen
   * @returns {import('./Screen.js').Screen}
   */
  open(screen) {
    const prev = this.top;
    if (prev && prev.el) prev.el.style.display = 'none';
    screen.el = screen.build();
    if (screen.el.classList.contains('menu-bg')) screen.el.style.backgroundImage = this.menuBackground;
    this.root.appendChild(screen.el);
    this.stack.push(screen);
    screen.onOpen();
    this.emit('change', screen);
    return screen;
  }

  /**
   * Closes a screen (defaults to the top one).
   * @param {import('./Screen.js').Screen} [screen]
   */
  close(screen = this.top) {
    const i = this.stack.indexOf(screen);
    if (i < 0) return;
    screen.onClose();
    screen.el?.remove();
    this.stack.splice(i, 1);
    const top = this.top;
    if (top && top.el) top.el.style.display = '';
    this.emit('change', top);
  }

  /**
   * Replaces the top screen.
   * @param {import('./Screen.js').Screen} screen
   */
  replace(screen) {
    if (this.top) this.close(this.top);
    this.open(screen);
  }

  /** Closes every screen. */
  closeAll() {
    while (this.stack.length) this.close(this.top);
  }

  /**
   * Updates the visible screen.
   * @param {number} dt
   */
  update(dt) {
    const top = this.top;
    if (top) top.update(dt);
  }

  /** UI click sound. */
  click() {
    this.audio?.unlock();
    this.audio?.play('ui.click', { category: 'ui', volume: 0.6 });
  }

  /** Removes listeners and screens. */
  dispose() {
    this.closeAll();
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.removeEventListener('click', this.onClick);
  }
}
