import { PhysicsBody } from '../physics/PhysicsBody.js';
import { EntityFlags } from '../networking/Protocol.js';

let nextEntityId = 1;

/**
 * @typedef {object} EntityContext
 * @property {import('../world/World.js').World} world
 * @property {import('./EntityManager.js').EntityManager} entities
 * @property {import('../world/DayNightCycle.js').DayNightCycle} cycle
 * @property {() => number} random
 * @property {Iterable<import('../networking/ServerPlayer.js').ServerPlayer>} players
 * @property {(stack: {id:number,count:number,damage?:number}, x:number, y:number, z:number, vx?:number, vy?:number, vz?:number, delay?:number) => void} spawnItem
 * @property {(player: object, amount: number, source: Entity|null, cause: string) => void} damagePlayer
 * @property {(entity: Entity, event: string, data?: object) => void} emitEvent
 */

/**
 * Base class for every simulated object in the world (mobs, dropped items,
 * falling blocks, projectiles). Entities are simulated by the server's
 * {@link EntityManager}; clients only receive snapshots.
 */
export class Entity {
  /**
   * @param {string} type entity type key (see EntityTypes)
   * @param {object} physics PhysicsBody options (width, height, ...)
   */
  constructor(type, physics) {
    this.id = nextEntityId++;
    this.type = type;
    this.body = new PhysicsBody(physics);
    this.yaw = 0;
    this.pitch = 0;
    this.age = 0;
    this.removed = false;
    /** Seconds without players nearby (used for despawning). */
    this.idleTime = 0;
  }

  /** Feet x. */
  get x() {
    return this.body.position.x;
  }

  /** Feet y. */
  get y() {
    return this.body.position.y;
  }

  /** Feet z. */
  get z() {
    return this.body.position.z;
  }

  /** Height of the eyes above the feet. */
  get eyeHeight() {
    return this.body.height * 0.85;
  }

  /**
   * Teleports the entity.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(x, y, z) {
    this.body.setPosition(x, y, z);
  }

  /**
   * Squared distance to a point.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  distanceSq(x, y, z) {
    const dx = this.x - x;
    const dy = this.y - y;
    const dz = this.z - z;
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Advances the entity by one server tick.
   * @param {number} dt seconds
   * @param {EntityContext} _ctx
   */
  tick(dt, _ctx) {
    this.age += dt;
  }

  /** Flags for snapshots. @returns {number} */
  snapshotFlags() {
    let f = 0;
    if (this.body.onGround) f |= EntityFlags.ON_GROUND;
    if (this.body.submersion > 0.3) f |= EntityFlags.IN_WATER;
    return f;
  }

  /** Type-specific snapshot payload. @returns {object|undefined} */
  snapshotData() {
    return undefined;
  }

  /**
   * Network snapshot of this entity.
   * @returns {import('../networking/Protocol.js').EntitySnapshot}
   */
  snapshot() {
    const snap = {
      id: this.id,
      t: this.type,
      x: Math.round(this.x * 1000) / 1000,
      y: Math.round(this.y * 1000) / 1000,
      z: Math.round(this.z * 1000) / 1000,
      yaw: Math.round(this.yaw * 1000) / 1000,
      pitch: Math.round(this.pitch * 1000) / 1000,
      f: this.snapshotFlags(),
    };
    const d = this.snapshotData();
    if (d !== undefined) snap.d = d;
    return snap;
  }

  /** Marks the entity for removal at the end of the tick. */
  remove() {
    this.removed = true;
  }

  /**
   * Whether this entity should despawn when far from players.
   * @returns {boolean}
   */
  canDespawn() {
    return true;
  }
}
