import { AABB } from '../physics/AABB.js';

/**
 * Server-side view of a connected player: last validated position, health,
 * air, fall tracking and game mode. Movement is client-predicted and
 * reported; the server validates it and owns everything that affects other
 * players or the world (health, damage, block changes, entities).
 */
export class ServerPlayer {
  /**
   * @param {number} id
   * @param {string} name
   * @param {import('./Transport.js').Transport} transport
   */
  constructor(id, name, transport) {
    this.id = id;
    this.name = name;
    this.transport = transport;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.eyeInWater = false;
    this.sneaking = false;
    this.flying = false;
    this.lastSeq = 0;
    this.gameMode = 'survival';
    this.maxHealth = 20;
    this.health = 20;
    this.maxAir = 15;
    this.air = 15;
    this.dead = false;
    this.hurtCooldown = 0;
    this.regenTimer = 0;
    this.drownTimer = 0;
    this.fallPeakY = null;
    this.spawn = { x: 0.5, y: 80, z: 0.5 };
    this.lastMoveTime = 0;
    this.connected = true;
    /** Skip movement validation for the next state (spawn, respawn). */
    this.trustNextMove = false;
    /** The spawn point is set from the first placed position. */
    this.firstSpawn = false;
    this.box = new AABB();
  }

  /**
   * Whether hostile mobs may target this player.
   * @returns {boolean}
   */
  canBeTargeted() {
    return this.connected && !this.dead && this.gameMode === 'survival';
  }

  /**
   * Player hitbox at the current position.
   * @returns {AABB}
   */
  hitbox() {
    return this.box.setFromFeet(this.x, this.y, this.z, 0.6, this.sneaking ? 1.5 : 1.8);
  }

  /**
   * Sends a message to this player.
   * @param {object} msg
   */
  send(msg) {
    this.transport.send(msg);
  }
}
