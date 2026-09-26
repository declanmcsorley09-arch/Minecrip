import { EventEmitter } from '../utils/EventEmitter.js';

/**
 * Keyboard, mouse and pointer-lock input with action bindings, per-frame
 * edge detection and double-tap detection.
 *
 * Events: `pointerlock` (locked:boolean), `key` (code) for raw presses.
 */
export class InputManager extends EventEmitter {
  /**
   * @param {HTMLElement} element element receiving pointer lock
   * @param {import('../settings/Settings.js').Settings} settings
   */
  constructor(element, settings) {
    super();
    this.element = element;
    this.settings = settings;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.buttons = new Set();
    this.buttonsPressed = new Set();
    this.buttonsReleased = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    /** Whether the game currently wants the pointer locked. */
    this.wantLock = false;
    /** When false, gameplay input is ignored (menus open). */
    this.enabled = true;
    this.lastPress = new Map();
    this.doubleTaps = new Set();

    this.onKeyDown = (e) => {
      if (e.repeat) {
        if (this.locked) e.preventDefault();
        return;
      }
      if (this.locked && !['F11', 'F12'].includes(e.code)) e.preventDefault();
      if (e.code === 'F1' || e.code === 'F3' || e.code === 'F5') e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
      const now = performance.now();
      const last = this.lastPress.get(e.code) ?? 0;
      if (now - last < 300) this.doubleTaps.add(e.code);
      this.lastPress.set(e.code, now);
      this.emit('key', e.code, e);
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    };
    this.onMouseDown = (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
    };
    this.onMouseUp = (e) => {
      this.buttons.delete(e.button);
      this.buttonsReleased.add(e.button);
    };
    this.onMouseMove = (e) => {
      if (!this.locked) return;
      // Guard against occasional huge spikes reported by some browsers on lock.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    };
    this.onWheel = (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    };
    this.onLockChange = () => {
      const locked = document.pointerLockElement === this.element;
      // requestPointerLock is asynchronous: a grant that arrives after
      // unlock() (e.g. a screen opened meanwhile) is released immediately.
      if (locked && !this.wantLock) {
        document.exitPointerLock();
        return;
      }
      if (locked === this.locked) return;
      this.locked = locked;
      if (!locked) this.releaseAll();
      this.emit('pointerlock', locked);
    };
    this.onBlur = () => this.releaseAll();
    this.onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  /** @private */
  code(action) {
    return this.settings.get('keybinds')[action];
  }

  /**
   * Whether an action's key is held.
   * @param {string} action
   * @returns {boolean}
   */
  isDown(action) {
    return this.enabled && this.keys.has(this.code(action));
  }

  /**
   * Whether an action's key was pressed this frame.
   * @param {string} action
   * @returns {boolean}
   */
  wasPressed(action) {
    return this.enabled && this.pressed.has(this.code(action));
  }

  /**
   * Whether an action's key was double-tapped this frame.
   * @param {string} action
   * @returns {boolean}
   */
  wasDoubleTapped(action) {
    return this.enabled && this.doubleTaps.has(this.code(action));
  }

  /**
   * Raw key code pressed this frame (for number keys etc.).
   * @param {string} code
   * @returns {boolean}
   */
  codePressed(code) {
    return this.enabled && this.pressed.has(code);
  }

  /**
   * @param {number} button 0 left, 1 middle, 2 right
   * @returns {boolean}
   */
  mouseDown(button) {
    return this.enabled && this.buttons.has(button);
  }

  /**
   * @param {number} button
   * @returns {boolean}
   */
  mousePressed(button) {
    return this.enabled && this.buttonsPressed.has(button);
  }

  /**
   * Returns and resets accumulated mouse movement.
   * @returns {{dx:number, dy:number}}
   */
  consumeMouse() {
    const r = { dx: this.enabled ? this.dx : 0, dy: this.enabled ? this.dy : 0 };
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  /**
   * Returns and resets the accumulated wheel steps.
   * @returns {number}
   */
  consumeWheel() {
    const w = this.enabled ? this.wheel : 0;
    this.wheel = 0;
    return w;
  }

  /** Clears per-frame edge state. Call at the end of each frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
    this.doubleTaps.clear();
  }

  /** Releases every held key/button (focus loss, pointer unlock). */
  releaseAll() {
    this.keys.clear();
    this.buttons.clear();
    this.dx = 0;
    this.dy = 0;
  }

  /** Requests pointer lock on the game canvas. */
  lock() {
    this.wantLock = true;
    if (document.pointerLockElement === this.element) return;
    const req = this.element.requestPointerLock?.({ unadjustedMovement: true });
    if (req && typeof req.catch === 'function') {
      req.catch(() => {
        if (!this.wantLock) return;
        const fallback = this.element.requestPointerLock?.();
        if (fallback && typeof fallback.catch === 'function') fallback.catch(() => {});
      });
    }
  }

  /** Exits pointer lock. */
  unlock() {
    this.wantLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Removes all listeners. */
  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    this.removeAllListeners();
  }
}
