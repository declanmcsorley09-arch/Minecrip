import { EventEmitter } from '../utils/EventEmitter.js';
import { clamp, damp } from '../utils/math.js';
import { isPointInFluid } from '../physics/Collision.js';
import { PLAYER_HEIGHT, PLAYER_SNEAK_HEIGHT, EYE_HEIGHT, SNEAK_EYE_HEIGHT } from './Player.js';

/** Movement speeds in blocks per second. */
export const SPEED = Object.freeze({
  walk: 4.317,
  sprint: 5.612,
  sneak: 1.31,
  swim: 2.2,
  swimSprint: 3.4,
  fly: 10.9,
  flySprint: 21.6,
});

const JUMP_VELOCITY = 8.8;
const STEP_DISTANCE = 1.7;

/**
 * First-person movement controller (client-side prediction). Converts input
 * into velocity using ground/air/water/flight acceleration models and runs
 * the shared {@link PhysicsBody} at a fixed rate.
 *
 * Events: `jump`, `footstep` (blockId), `land` ({distance, blockId}),
 * `splash` (speed), `flyToggle` (flying).
 */
export class PlayerController extends EventEmitter {
  /**
   * @param {import('./Player.js').Player} player
   * @param {import('./InputManager.js').InputManager} input
   * @param {import('../world/World.js').World} world
   */
  constructor(player, input, world) {
    super();
    this.player = player;
    this.input = input;
    this.world = world;
    this.jumpCooldown = 0;
    this.stepAccumulator = 0;
  }

  /**
   * Applies mouse look. Called every rendered frame for minimal latency.
   * @param {number} sensitivity 0..1 setting
   * @param {boolean} invertY
   */
  updateLook(sensitivity, invertY) {
    const { dx, dy } = this.input.consumeMouse();
    const p = this.player;
    if (p.dead) return;
    const s = 0.0004 + sensitivity * sensitivity * 0.006;
    p.yaw -= dx * s;
    p.pitch -= dy * s * (invertY ? -1 : 1);
    p.pitch = clamp(p.pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
    p.yaw %= Math.PI * 2;
  }

  /**
   * Adds server-sent knockback.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  applyKnockback(x, y, z) {
    const v = this.player.body.velocity;
    v.x += x;
    v.y = Math.max(v.y, y);
    v.z += z;
  }

  /**
   * One fixed physics step.
   * @param {number} dt seconds
   */
  fixedUpdate(dt) {
    const p = this.player;
    const body = p.body;
    const input = this.input;
    const world = this.world;
    p.prevPosition.x = body.position.x;
    p.prevPosition.y = body.position.y;
    p.prevPosition.z = body.position.z;
    p.prevWalkDistance = p.walkDistance;
    if (p.hurtTime > 0) p.hurtTime -= dt;
    if (p.swingTime > 0) p.swingTime -= dt;
    if (!world.isLoaded(body.position.x, body.position.z)) return;

    const alive = !p.dead;
    let forward = 0;
    let strafe = 0;
    if (alive) {
      forward = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
      strafe = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    }
    const jump = alive && input.isDown('jump');

    // Flight (creative only).
    if (!p.creative) p.flying = false;
    else if (input.wasDoubleTapped('jump')) {
      p.flying = !p.flying;
      body.velocity.y = 0;
      this.emit('flyToggle', p.flying);
    }
    if (p.flying && body.onGround && input.isDown('sneak')) p.flying = false;

    // Sneaking (cannot stand up under a low ceiling).
    const wantSneak = alive && input.isDown('sneak') && !p.flying;
    if (wantSneak !== p.sneaking) {
      if (wantSneak) {
        p.sneaking = true;
        body.setHeight(PLAYER_SNEAK_HEIGHT);
      } else if (body.canResize(world, PLAYER_HEIGHT)) {
        p.sneaking = false;
        body.setHeight(PLAYER_HEIGHT);
      }
    }

    // Sprinting.
    if (forward > 0 && !p.sneaking && (input.isDown('sprint') || input.wasDoubleTapped('forward'))) p.sprinting = true;
    if (forward <= 0 || p.sneaking || body.collidedHorizontally || p.dead) p.sprinting = false;

    const inWater = body.submersion > 0.1 && !p.flying;
    let speed;
    if (p.flying) speed = p.sprinting ? SPEED.flySprint : SPEED.fly;
    else if (inWater) speed = p.sprinting ? SPEED.swimSprint : SPEED.swim;
    else if (p.sneaking) speed = SPEED.sneak;
    else speed = p.sprinting ? SPEED.sprint : SPEED.walk;

    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    let wx = -sin * forward + cos * strafe;
    let wz = -cos * forward - sin * strafe;
    const len = Math.hypot(wx, wz);
    if (len > 0) {
      wx = (wx / len) * speed;
      wz = (wz / len) * speed;
    }

    let k;
    if (p.flying) k = 7;
    else if (inWater) k = 5;
    else if (body.onGround) k = 16 * Math.pow(0.6 / body.groundSlipperiness, 4);
    else k = 3.2;
    const f = damp(k, dt);
    const v = body.velocity;
    v.x += (wx - v.x) * f;
    v.z += (wz - v.z) * f;

    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
    if (p.flying) {
      const target = (jump ? 1 : 0) * 8 - (input.isDown('sneak') ? 1 : 0) * 8;
      v.y += (target - v.y) * damp(10, dt);
    } else if (inWater) {
      if (jump) {
        v.y = Math.min(v.y + 20 * dt, 3.2);
        // Leap out of the water onto an adjacent ledge.
        if (body.collidedHorizontally && body.submersion < 0.7) v.y = Math.max(v.y, 6.5);
      }
    } else if (jump && body.onGround && this.jumpCooldown <= 0) {
      v.y = JUMP_VELOCITY;
      this.jumpCooldown = 0.1;
      if (p.sprinting) {
        v.x += -sin * 2.2;
        v.z += -cos * 2.2;
      }
      this.emit('jump');
    }

    const wasOnGround = body.onGround;
    const px = body.position.x;
    const pz = body.position.z;
    const ev = body.step(world, dt, { gravity: !p.flying, edgeGuard: p.sneaking && wasOnGround });

    if (body.onGround && !p.flying) {
      const moved = Math.hypot(body.position.x - px, body.position.z - pz);
      p.walkDistance += moved;
      this.stepAccumulator += moved;
      if (this.stepAccumulator >= STEP_DISTANCE) {
        this.stepAccumulator = 0;
        this.emit('footstep', this.blockBelow());
      }
    }
    if (ev.landed > 0.1 && !p.flying) this.emit('land', { distance: ev.landed, blockId: this.blockBelow() });
    if (ev.enteredFluid) this.emit('splash', Math.abs(v.y));

    // Smooth eye height for sneaking.
    const targetEye = p.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
    p.eyeHeight += (targetEye - p.eyeHeight) * damp(18, dt);
    p.eyeInWater = isPointInFluid(world, body.position.x, body.position.y + p.eyeHeight, body.position.z);
  }

  /**
   * Block id under the player's feet.
   * @returns {number}
   */
  blockBelow() {
    const pos = this.player.body.position;
    return this.world.getBlock(Math.floor(pos.x), Math.floor(pos.y - 0.2), Math.floor(pos.z));
  }
}
