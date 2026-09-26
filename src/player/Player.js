import { PhysicsBody } from '../physics/PhysicsBody.js';
import { PlayerInventory } from '../inventory/Inventory.js';

/** Standing and sneaking body dimensions. */
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_SNEAK_HEIGHT = 1.5;
export const EYE_HEIGHT = 1.62;
export const SNEAK_EYE_HEIGHT = 1.27;

/**
 * The local player's client-side state: predicted physics body, view
 * angles, movement modes, inventory and the health values last received
 * from the server.
 */
export class Player {
  constructor() {
    this.body = new PhysicsBody({ width: PLAYER_WIDTH, height: PLAYER_HEIGHT, stepHeight: 0.6 });
    this.inventory = new PlayerInventory();
    this.yaw = 0;
    this.pitch = 0;
    this.gameMode = 'survival';
    this.flying = false;
    this.sprinting = false;
    this.sneaking = false;
    this.health = 20;
    this.maxHealth = 20;
    this.air = 15;
    this.maxAir = 15;
    this.dead = false;
    /** Smoothed eye height (sneak transitions). */
    this.eyeHeight = EYE_HEIGHT;
    /** Position at the previous physics step (for render interpolation). */
    this.prevPosition = { x: 0, y: 0, z: 0 };
    /** Distance walked on the ground (drives bobbing and footsteps). */
    this.walkDistance = 0;
    this.prevWalkDistance = 0;
    this.hurtTime = 0;
    this.swingTime = 0;
    this.eyeInWater = false;
    this.spawn = { x: 0.5, y: 80, z: 0.5 };
  }

  /** Feet position. */
  get position() {
    return this.body.position;
  }

  /** Whether the player is in creative mode. */
  get creative() {
    return this.gameMode === 'creative';
  }

  /** Block reach distance. */
  get reach() {
    return this.creative ? 6 : 5;
  }

  /**
   * Teleports the player and resets interpolation.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  teleport(x, y, z) {
    this.body.setPosition(x, y, z);
    this.body.velocity.x = 0;
    this.body.velocity.y = 0;
    this.body.velocity.z = 0;
    this.body.fallDistance = 0;
    this.prevPosition.x = x;
    this.prevPosition.y = y;
    this.prevPosition.z = z;
  }

  /**
   * Unit look direction.
   * @param {{x:number,y:number,z:number}} out
   * @returns {{x:number,y:number,z:number}}
   */
  lookDirection(out) {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = Math.sin(this.pitch);
    out.z = -Math.cos(this.yaw) * cp;
    return out;
  }

  /**
   * Serialisable snapshot for saving (health is server-owned and saved from
   * the server's view).
   * @returns {object}
   */
  toJSON() {
    const p = this.position;
    return {
      x: p.x, y: p.y, z: p.z, yaw: this.yaw, pitch: this.pitch,
      flying: this.flying, selected: this.inventory.selected, inventory: this.inventory.toJSON(),
    };
  }
}
