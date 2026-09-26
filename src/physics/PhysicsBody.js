import { AABB } from './AABB.js';
import { moveBox, isColliding, fluidSubmersion } from './Collision.js';
import { blockRegistry } from '../blocks/index.js';

/**
 * Rigid-body style physics for any entity that walks, falls or swims:
 * gravity, swept AABB collision with wall sliding, automatic step-up,
 * sneak edge protection, fluid drag and fall-distance tracking.
 * Entirely independent of rendering (used by client prediction, the server
 * and mob AI alike).
 */

const scratch = new AABB();
const probe = new AABB();
const result = { dx: 0, dy: 0, dz: 0, collidedX: false, collidedY: false, collidedZ: false, onGround: false };
const stepResult = { dx: 0, dy: 0, dz: 0, collidedX: false, collidedY: false, collidedZ: false, onGround: false };

/**
 * @typedef {object} StepOptions
 * @property {boolean} [gravity=true] apply gravity
 * @property {boolean} [edgeGuard=false] refuse to walk off ledges (sneaking)
 * @property {boolean} [stepUp=true] climb small ledges automatically
 * @property {boolean} [noClip=false] ignore collisions entirely
 */

/**
 * @typedef {object} StepEvents
 * @property {number} landed fall distance when landing this step, else 0
 * @property {boolean} enteredFluid
 * @property {boolean} steppedUp
 */

export class PhysicsBody {
  /**
   * @param {object} opts
   * @param {number} opts.width
   * @param {number} opts.height
   * @param {number} [opts.stepHeight=0.6]
   * @param {number} [opts.gravity=32] blocks/s²
   * @param {number} [opts.maxFallSpeed=78] blocks/s
   * @param {number} [opts.fluidGravity=6]
   * @param {number} [opts.fluidDrag=2.5] per second
   */
  constructor({ width, height, stepHeight = 0.6, gravity = 32, maxFallSpeed = 78, fluidGravity = 6, fluidDrag = 2.5 }) {
    this.width = width;
    this.height = height;
    this.stepHeight = stepHeight;
    this.gravity = gravity;
    this.maxFallSpeed = maxFallSpeed;
    this.fluidGravity = fluidGravity;
    this.fluidDrag = fluidDrag;
    this.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.box = new AABB();
    this.onGround = false;
    this.collidedHorizontally = false;
    this.collidedVertically = false;
    /** Fraction of the body submerged in fluid (0..1). */
    this.submersion = 0;
    this.fallDistance = 0;
    /** Slipperiness of the block below (0.6 normal, 0.98 ice). */
    this.groundSlipperiness = 0.6;
    this.events = { landed: 0, enteredFluid: false, steppedUp: false };
  }

  /**
   * Teleports the body (feet position).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(x, y, z) {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    this.box.setFromFeet(x, y, z, this.width, this.height);
  }

  /**
   * Changes the body height (e.g. sneaking), keeping the feet in place.
   * @param {number} h
   */
  setHeight(h) {
    this.height = h;
    this.box.setFromFeet(this.position.x, this.position.y, this.position.z, this.width, h);
  }

  /**
   * Whether the body could stand up to height `h` without colliding.
   * @param {import('./Collision.js').BlockGetter} world
   * @param {number} h
   * @returns {boolean}
   */
  canResize(world, h) {
    probe.setFromFeet(this.position.x, this.position.y, this.position.z, this.width, h);
    return !isColliding(world, probe);
  }

  /**
   * Integrates one fixed physics step.
   * @param {import('./Collision.js').BlockGetter & {getBlock: Function}} world
   * @param {number} dt seconds
   * @param {StepOptions} [opts]
   * @returns {StepEvents}
   */
  step(world, dt, opts = {}) {
    const { gravity = true, edgeGuard = false, stepUp = true, noClip = false } = opts;
    const v = this.velocity;
    const ev = this.events;
    ev.landed = 0;
    ev.steppedUp = false;

    const wasInFluid = this.submersion > 0;
    this.submersion = fluidSubmersion(world, this.box);
    ev.enteredFluid = !wasInFluid && this.submersion > 0;

    if (gravity) {
      if (this.submersion > 0.05) {
        v.y -= this.fluidGravity * dt;
        const drag = Math.exp(-this.fluidDrag * dt);
        v.y *= drag;
      } else {
        v.y -= this.gravity * dt;
      }
      if (v.y < -this.maxFallSpeed) v.y = -this.maxFallSpeed;
    }

    let dx = v.x * dt;
    const dy = v.y * dt;
    let dz = v.z * dt;

    if (noClip) {
      this.box.translate(dx, dy, dz);
      this.syncPosition();
      this.onGround = false;
      return ev;
    }

    if (edgeGuard && this.onGround) {
      const step = 0.05;
      const test = (ox, oz) => {
        probe.copy(this.box).translate(ox, -this.stepHeight, oz);
        return !isColliding(world, probe);
      };
      while (dx !== 0 && test(dx, 0)) dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
      while (dz !== 0 && test(0, dz)) dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
      while (dx !== 0 && dz !== 0 && test(dx, dz)) {
        dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
        dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
      }
    }

    scratch.copy(this.box);
    moveBox(world, this.box, dx, dy, dz, result);

    // Step up onto ledges no higher than stepHeight.
    const blocked = result.collidedX || result.collidedZ;
    if (stepUp && blocked && (this.onGround || result.onGround) && this.stepHeight > 0) {
      probe.copy(scratch);
      moveBox(world, probe, 0, this.stepHeight, 0, stepResult);
      const raised = stepResult.dy;
      moveBox(world, probe, dx, 0, dz, stepResult);
      const sx = stepResult.dx;
      const sz = stepResult.dz;
      moveBox(world, probe, 0, -raised, 0, stepResult);
      const gained = sx * sx + sz * sz;
      const had = result.dx * result.dx + result.dz * result.dz;
      if (gained > had + 1e-6) {
        this.box.copy(probe);
        result.dx = sx;
        result.dz = sz;
        result.collidedX = sx !== dx;
        result.collidedZ = sz !== dz;
        result.onGround = true;
        ev.steppedUp = true;
      }
    }

    this.syncPosition();
    this.collidedHorizontally = result.collidedX || result.collidedZ;
    this.collidedVertically = result.collidedY;
    if (result.collidedX) v.x = 0;
    if (result.collidedZ) v.z = 0;
    if (result.collidedY) v.y = 0;

    const wasOnGround = this.onGround;
    this.onGround = result.onGround || (ev.steppedUp && v.y <= 0);
    if (this.submersion > 0) this.fallDistance = 0;
    else if (!this.onGround && result.dy < 0) this.fallDistance -= result.dy;
    if (this.onGround && !wasOnGround) ev.landed = this.fallDistance;
    if (this.onGround) this.fallDistance = 0;
    if (this.onGround) this.groundSlipperiness = this.slipperinessBelow(world);
    return ev;
  }

  /** @private */
  syncPosition() {
    this.position.x = (this.box.minX + this.box.maxX) / 2;
    this.position.y = this.box.minY;
    this.position.z = (this.box.minZ + this.box.maxZ) / 2;
  }

  /**
   * Slipperiness of the block under the feet.
   * @private
   */
  slipperinessBelow(world) {
    const id = world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y - 0.01), Math.floor(this.position.z));
    return id === 0 ? 0.6 : blockRegistry.get(id).slipperiness;
  }
}
