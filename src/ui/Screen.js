/**
 * Base class for UI screens managed by the {@link UIManager}.
 */
export class Screen {
  /**
   * @param {import('./UIManager.js').UIManager} ui
   */
  constructor(ui) {
    this.ui = ui;
    /** @type {HTMLElement|null} */
    this.el = null;
    /** Whether the world keeps running (and remains visible) under this screen. */
    this.overlay = false;
  }

  /**
   * Creates the screen's root element.
   * @returns {HTMLElement}
   */
  build() {
    throw new Error('Screen.build not implemented');
  }

  /** Called after the element is attached. */
  onOpen() {}

  /** Called before the element is removed. */
  onClose() {}

  /**
   * Keyboard handler for the top-most screen.
   * @param {KeyboardEvent} _e
   * @returns {boolean} true if handled
   */
  onKey(_e) {
    return false;
  }

  /** Escape pressed: closes the screen by default. */
  onEscape() {
    this.ui.close(this);
  }

  /**
   * Per-frame update while visible.
   * @param {number} _dt
   */
  update(_dt) {}
}
