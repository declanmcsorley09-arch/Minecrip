import { Screen } from '../Screen.js';
import { h, button } from '../dom.js';

/**
 * In-game overlay screens: pause menu, death screen and the
 * "click to resume" prompt shown when pointer lock is lost.
 * @module ui/screens/GameScreens
 */

export class PauseScreen extends Screen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {import('../../core/App.js').App} app
   */
  constructor(ui, app) {
    super(ui);
    this.app = app;
  }

  build() {
    const game = this.app.game;
    const mode = () => (game.player.gameMode === 'creative' ? 'Creative' : 'Survival');
    this.modeBtn = button(`Game Mode: ${mode()}`, () => {
      const next = game.player.gameMode === 'creative' ? 'survival' : 'creative';
      game.setGameMode(next);
      this.modeBtn.textContent = `Game Mode: ${next === 'creative' ? 'Creative' : 'Survival'}`;
    }, { wide: true });
    return h('div.screen.dim', {},
      h('h2', {}, 'Game Menu'),
      h('div.column', {},
        button('Back to Game', () => this.app.resumeGame(), { wide: true }),
        this.modeBtn,
        button('Options…', () => this.app.openSettings(true), { wide: true }),
        button('Save and Quit to Title', () => this.app.quitToTitle(), { wide: true }),
      ),
      h('div.hint', { style: { marginTop: '10px' } }, `World: ${this.app.game.meta.name} · Seed ${this.app.game.meta.seedText ?? this.app.game.meta.seed}`),
    );
  }

  onEscape() {
    this.app.resumeGame();
  }
}

export class DeathScreen extends Screen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {import('../../core/App.js').App} app
   * @param {string} cause
   */
  constructor(ui, app, cause) {
    super(ui);
    this.app = app;
    this.cause = cause;
  }

  build() {
    const causes = {
      fall: 'You hit the ground too hard.',
      drowning: 'You drowned.',
      void: 'You fell out of the world.',
      zombie: 'You were slain by a Zombie.',
      arrow: 'You were shot by a Skeleton.',
    };
    return h('div.screen.death-screen', {},
      h('h1', {}, 'You Died!'),
      h('div.death-cause', {}, causes[this.cause] ?? 'You died.'),
      h('div.column', {},
        button('Respawn', () => this.app.respawn(), { wide: true }),
        button('Title Screen', () => this.app.quitToTitle(), { wide: true }),
      ),
    );
  }

  onEscape() {}
}
