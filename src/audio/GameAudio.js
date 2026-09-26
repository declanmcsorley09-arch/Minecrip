import { blockRegistry } from '../blocks/index.js';

/**
 * Connects gameplay events (movement, interaction, entity events from the
 * server) to sound playback.
 */
export class GameAudio {
  /**
   * @param {import('./AudioEngine.js').AudioEngine} engine
   * @param {object} deps
   * @param {import('../player/PlayerController.js').PlayerController} deps.controller
   * @param {import('../player/BlockInteraction.js').BlockInteraction} deps.interaction
   * @param {import('../networking/GameClient.js').GameClient} deps.client
   * @param {import('../player/Player.js').Player} deps.player
   */
  constructor(engine, { controller, interaction, client, player }) {
    this.engine = engine;
    this.player = player;
    this.client = client;
    this.eatTimer = 0;
    this.swimTimer = 0;
    this.unsubscribe = [];
    const on = (emitter, event, fn) => this.unsubscribe.push(emitter.on(event, fn));

    on(controller, 'footstep', (blockId) => {
      if (!blockId) return;
      this.engine.play(`step.${this.sound(blockId)}`, { category: 'player', volume: player.sneaking ? 0.12 : 0.28 });
    });
    on(controller, 'jump', () => this.engine.play('player.jump', { category: 'player', volume: 0.5 }));
    on(controller, 'land', ({ distance, blockId }) => {
      if (distance > 1.2) this.engine.play('player.land', { category: 'player', volume: Math.min(1, distance / 8) });
      if (blockId) this.engine.play(`step.${this.sound(blockId)}`, { category: 'player', volume: 0.4 });
    });
    on(controller, 'splash', (speed) => this.engine.play('player.splash', { category: 'player', volume: Math.min(1, 0.3 + speed / 15) }));

    on(interaction, 'dig', (hit) => this.engine.play(`dig.${this.sound(hit.id)}`, { position: center(hit), volume: 0.45 }));
    on(interaction, 'blockBreak', (b) => this.engine.play(`break.${this.sound(b.id)}`, { position: center(b) }));
    on(interaction, 'blockPlace', (b) => this.engine.play(`place.${this.sound(b.id)}`, { position: center(b) }));
    on(interaction, 'attack', () => this.engine.play('player.swing', { category: 'player' }));
    on(interaction, 'eat', () => this.engine.play('player.eat', { category: 'player', volume: 0.8, pitch: 0.8 }));
    on(interaction, 'eating', () => {
      if (this.eatTimer > 0) return;
      this.eatTimer = 0.22;
      this.engine.play('player.eat', { category: 'player', volume: 0.5 });
    });
    on(interaction, 'toolBroke', () => this.engine.play('tool.break', { category: 'player' }));

    on(client, 'entityEvent', (msg) => this.onEntityEvent(msg));
    on(client, 'health', (msg) => {
      if (msg.cause && msg.cause !== 'drowning') this.engine.play('player.hurt', { category: 'player', volume: 0.8 });
      else if (msg.cause === 'drowning') this.engine.play('player.hurt', { category: 'player', volume: 0.6, pitch: 1.2 });
    });
  }

  /** Sound type of a block. @private */
  sound(blockId) {
    const s = blockRegistry.get(blockId).sound;
    return s === 'none' ? 'stone' : s;
  }

  /** @private */
  onEntityEvent({ id, event, data }) {
    if (id === 0) {
      // Block events from other players (the local player hears its own immediately).
      if (!data || data.player === this.client.playerId) return;
      const kind = event === 'block_break' ? 'break' : 'place';
      this.engine.play(`${kind}.${this.sound(data.block)}`, { position: center(data) });
      return;
    }
    const e = this.client.entities.get(id);
    const pos = e ? { x: e.x, y: e.y + 1, z: e.z } : null;
    switch (event) {
      case 'ambient':
        if (e) this.engine.play(`mob.${e.type}.ambient`, { position: pos, category: 'mobs', volume: 0.8 });
        break;
      case 'hurt':
        if (e) this.engine.play(`mob.${e.type}.hurt`, { position: pos, category: 'mobs' });
        break;
      case 'death':
        if (e) this.engine.play('mob.death', { position: pos, category: 'mobs', pitch: e.type === 'pig' ? 1.4 : e.type === 'zombie' ? 0.6 : 1 });
        break;
      case 'shoot':
        this.engine.play('mob.skeleton.shoot', { position: pos, category: 'mobs' });
        break;
      case 'attack':
        this.engine.play('mob.zombie.attack', { position: pos, category: 'mobs', volume: 0.7 });
        break;
      case 'hit':
        this.engine.play('arrow.hit', { position: pos, category: 'mobs', volume: 0.6 });
        break;
      case 'pickup':
        if (data?.player === this.client.playerId) this.engine.play('player.pop', { category: 'player', volume: 0.5, pitch: 1 + Math.random() * 0.6 });
        break;
      default:
        break;
    }
  }

  /**
   * Per-frame housekeeping (throttles, swimming strokes).
   * @param {number} dt
   */
  update(dt) {
    this.eatTimer -= dt;
    this.swimTimer -= dt;
    const b = this.player.body;
    const speed = Math.hypot(b.velocity.x, b.velocity.z);
    if (b.submersion > 0.4 && speed > 1 && this.swimTimer <= 0) {
      this.swimTimer = 0.7;
      this.engine.play('player.swim', { category: 'player', volume: 0.5 });
    }
  }

  /**
   * Thunder rumble after a lightning flash.
   */
  thunder() {
    const delay = 300 + Math.random() * 2500;
    setTimeout(() => this.engine.play('weather.thunder', { category: 'ambient', volume: 0.9, reverb: 0.5 }), delay);
  }

  /** Removes all listeners. */
  dispose() {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }
}

/**
 * Centre of a block position.
 * @param {{x:number,y:number,z:number}} b
 * @returns {{x:number,y:number,z:number}}
 */
function center(b) {
  return { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 };
}
