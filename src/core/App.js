import { Settings } from '../settings/Settings.js';
import { Database } from '../save/Database.js';
import { WorldList, MemoryWorldList, settingsAdapter } from '../save/WorldList.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { BlockTextureArray } from '../renderer/textures/BlockTextureArray.js';
import { ItemIcons, toCanvas } from '../renderer/ItemIcons.js';
import { blockRegistry } from '../blocks/index.js';
import { UIManager } from '../ui/UIManager.js';
import { HUD } from '../ui/hud/HUD.js';
import { MainMenuScreen, LoadingScreen } from '../ui/screens/MenuScreens.js';
import { SettingsScreen, toggleFullscreen } from '../ui/screens/SettingsScreen.js';
import { PauseScreen, DeathScreen } from '../ui/screens/GameScreens.js';
import { InventoryScreen, CraftingTableScreen, FurnaceScreen, CreativeScreen } from '../ui/screens/InventoryScreens.js';
import { InputManager } from '../player/InputManager.js';
import { Game } from './Game.js';

/**
 * Application shell: owns global services (settings, database, audio,
 * textures, UI) and the lifecycle of game sessions — menus → loading →
 * playing → pause/containers → save and quit.
 */
export class App {
  /**
   * @param {object} dom
   * @param {HTMLCanvasElement} dom.canvas
   * @param {HTMLElement} dom.ui
   */
  constructor({ canvas, ui }) {
    this.canvas = canvas;
    this.uiRoot = ui;
    /** @type {Game|null} */
    this.game = null;
    this.expectUnlock = false;
    this.quitting = false;
  }

  /** Initialises services and shows the title screen. */
  async init() {
    try {
      this.db = await Database.open();
    } catch (e) {
      console.warn('IndexedDB unavailable, worlds will not be saved:', e.message);
      this.db = null;
    }
    this.settings = new Settings(this.db ? settingsAdapter(this.db) : null);
    await this.settings.load().catch((e) => console.warn('Failed to load settings', e));
    this.worldList = this.db ? new WorldList(this.db) : new MemoryWorldList();
    this.audio = new AudioEngine(this.settings);
    this.blockTextures = new BlockTextureArray(blockRegistry);
    this.icons = new ItemIcons(this.blockTextures);
    this.input = new InputManager(this.canvas, this.settings);
    this.ui = new UIManager(this.uiRoot, {
      settings: this.settings,
      icons: this.icons,
      audio: this.audio,
      menuBackground: `url(${this.menuTexture()})`,
    });
    this.hud = new HUD(this.uiRoot, this.icons);

    this.input.on('pointerlock', (locked) => this.onPointerLock(locked));
    this.input.on('key', (code, e) => this.onGameKey(code, e));
    this.ui.on('change', () => this.onScreensChanged());
    window.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.audio.unlock(), { capture: true });
    window.addEventListener('beforeunload', () => {
      if (this.game) this.game.save();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game && this.game.ready) this.game.save().catch(() => {});
    });
    this.canvas.addEventListener('click', () => {
      if (this.game && this.game.ready && !this.ui.hasScreen && !this.input.locked) this.input.lock();
    });

    this.last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.ui.update(dt);
      if (this.game && this.game.ready) this.hud.update(dt, this.game);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    this.ui.open(new MainMenuScreen(this.ui, this));
    document.getElementById('boot')?.remove();
  }

  /** Darkened, tiled dirt texture for menu backgrounds. @private */
  menuTexture() {
    const img = this.blockTextures.image(blockRegistry.textureOf(blockRegistry.ids.dirt, 0));
    return toCanvas(img).toDataURL();
  }

  /** @returns {Promise<object[]>} */
  listWorlds() {
    return this.worldList.list();
  }

  /**
   * @param {{name:string, seed:string, gameMode:string}} opts
   * @returns {Promise<object>}
   */
  createWorld(opts) {
    return this.worldList.create(opts);
  }

  /** @param {string} id */
  deleteWorld(id) {
    return this.worldList.delete(id);
  }

  /**
   * Opens the settings screen.
   * @param {boolean} [inGame=false]
   */
  openSettings(inGame = false) {
    this.ui.open(new SettingsScreen(this.ui, this.settings, inGame));
  }

  /**
   * Loads a world and starts playing.
   * @param {object} meta world record
   */
  async playWorld(meta) {
    this.ui.closeAll();
    const loading = this.ui.open(new LoadingScreen(this.ui, `Loading "${meta.name}"`));
    loading.setProgress(0, 'Building terrain…');
    const game = new Game({
      canvas: this.canvas,
      settings: this.settings,
      audio: this.audio,
      db: this.db,
      meta: { ...meta },
      blockTextures: this.blockTextures,
      icons: this.icons,
      input: this.input,
    });
    this.game = game;
    game.on('progress', (p) => loading.setProgress(p, p < 1 ? 'Generating terrain…' : 'Building meshes…'));
    game.on('chat', (m) => this.hud.addChat(m.text, m.color));
    game.on('died', (m) => {
      this.hud.closeChat();
      this.ui.closeAll();
      this.ui.open(new DeathScreen(this.ui, this, m.cause));
    });
    game.on('openContainer', (info) => this.openContainer(info));
    game.on('saved', () => this.hud.flashSaving());
    game.on('gameMode', (mode) => this.hud.addChat(`Game mode set to ${mode}`, '#a0e0ff'));
    try {
      await game.start();
    } catch (e) {
      console.error('Failed to start world', e);
      loading.setProgress(0, `Failed to load world: ${e.message}`);
      return;
    }
    if (this.game !== game) return;
    this.ui.close(loading);
    this.hud.show();
    this.hud.addChat(`Welcome to ${meta.name}! Press E for inventory, T to chat, / for commands, F3 for debug.`, '#ffe08a');
    this.showPause();
  }

  /** Shows the pause menu (also the "click to play" state). */
  showPause() {
    if (!this.game) return;
    this.game.pause();
    if (!(this.ui.top instanceof PauseScreen)) {
      this.ui.closeAll();
      this.ui.open(new PauseScreen(this.ui, this));
    }
  }

  /** Returns to the game from a menu (requires a user gesture). */
  resumeGame() {
    if (!this.game || !this.game.ready) return;
    this.ui.closeAll();
    this.input.lock();
    // Resume immediately; if the lock is refused the pause menu reappears.
    this.game.resume();
  }

  /** Respawns after death. */
  respawn() {
    if (!this.game) return;
    this.game.respawn();
    this.ui.closeAll();
    this.input.lock();
    this.game.resume();
  }

  /** Saves the world and returns to the title screen. */
  async quitToTitle() {
    if (!this.game || this.quitting) return;
    this.quitting = true;
    const game = this.game;
    this.ui.closeAll();
    const saving = this.ui.open(new LoadingScreen(this.ui, 'Saving world'));
    saving.setProgress(0.5, 'Saving chunks…');
    try {
      await game.save();
    } catch (e) {
      console.error('Save failed', e);
    }
    this.game = null;
    game.dispose();
    this.hud.hide();
    this.input.unlock();
    this.ui.closeAll();
    this.ui.open(new MainMenuScreen(this.ui, this));
    this.quitting = false;
  }

  /**
   * Opens a block's container UI.
   * @param {{x:number,y:number,z:number,kind:string}} info
   */
  openContainer(info) {
    if (!this.game) return;
    this.expectUnlock = true;
    const screen = info.kind === 'furnace' ? new FurnaceScreen(this.ui, this.game, info) : new CraftingTableScreen(this.ui, this.game);
    this.ui.open(screen);
    this.game.setInputEnabled(false);
  }

  /** @private */
  openInventory() {
    const game = this.game;
    this.expectUnlock = true;
    this.input.unlock();
    game.setInputEnabled(false);
    this.ui.open(game.player.creative ? new CreativeScreen(this.ui, game) : new InventoryScreen(this.ui, game));
  }

  /** @private */
  openChat(prefix) {
    const game = this.game;
    this.expectUnlock = true;
    this.input.unlock();
    game.setInputEnabled(false);
    this.hud.openChat(prefix, (text) => game.sendChat(text), () => {
      if (!this.game) return;
      this.game.setInputEnabled(true);
      if (!this.ui.hasScreen) this.input.lock();
    });
  }

  /**
   * Global game hotkeys (only while playing with no screen open).
   * @private
   */
  onGameKey(code, e) {
    const game = this.game;
    if (!game || !game.ready || this.hud.chatOpen) return;
    const binds = this.settings.get('keybinds');
    if (code === binds.fullscreen) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (this.ui.hasScreen || game.paused || game.player.dead) return;
    if (code === binds.inventory) this.openInventory();
    else if (code === binds.chat) {
      e.preventDefault();
      this.openChat('');
    } else if (code === binds.command) {
      e.preventDefault();
      this.openChat('/');
    } else if (code === binds.debug) this.hud.toggleDebug();
    else if (code === binds.hideHud) {
      this.hud.toggleHidden();
      game.hideHand = !game.hideHand;
    }
  }

  /** @private */
  onPointerLock(locked) {
    const game = this.game;
    if (!game || !game.ready) return;
    if (locked) {
      this.expectUnlock = false;
      if (this.ui.top instanceof PauseScreen) this.ui.closeAll();
      if (!this.ui.hasScreen) {
        game.setInputEnabled(true);
        game.resume();
      }
      return;
    }
    if (this.expectUnlock) {
      this.expectUnlock = false;
      return;
    }
    if (game.player.dead || this.hud.chatOpen) return;
    if (!this.ui.hasScreen) this.showPause();
  }

  /** Re-locks the pointer when the last overlay screen closes. @private */
  onScreensChanged() {
    const game = this.game;
    if (!game || !game.ready || this.quitting) return;
    if (!this.ui.hasScreen && !game.paused && !game.player.dead) {
      game.setInputEnabled(true);
      this.input.lock();
      // If the browser refuses (no user gesture), fall back to the pause menu.
      setTimeout(() => {
        if (this.game === game && !this.input.locked && !this.ui.hasScreen && !game.player.dead && !this.hud.chatOpen) this.showPause();
      }, 250);
    }
  }
}
