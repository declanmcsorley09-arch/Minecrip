import { lerp, damp } from '../utils/math.js';

/**
 * Places the first-person camera: interpolates the physics position between
 * fixed steps, applies view bobbing, sprint/flight FOV changes and a damage
 * tilt.
 */
export class CameraController {
  /**
   * @param {import('three').PerspectiveCamera} camera
   * @param {import('./Player.js').Player} player
   */
  constructor(camera, player) {
    this.camera = camera;
    this.player = player;
    this.fov = camera.fov;
    this.baseFov = camera.fov;
    this.bobAmount = 0;
    this.tilt = 0;
    this.stepSmoothing = 0;
    this.lastEyeY = null;
  }

  /**
   * @param {number} dt frame time (s)
   * @param {number} alpha fixed-step interpolation factor 0..1
   * @param {object} opts
   * @param {number} opts.fov base FOV setting
   * @param {boolean} opts.bobbing view bobbing enabled
   */
  update(dt, alpha, { fov, bobbing }) {
    const p = this.player;
    const cam = this.camera;
    const pos = p.body.position;
    const prev = p.prevPosition;
    const x = lerp(prev.x, pos.x, alpha);
    const z = lerp(prev.z, pos.z, alpha);
    let eyeY = lerp(prev.y, pos.y, alpha) + p.eyeHeight;

    // Smooth out step-up snaps so climbing half blocks doesn't jolt the view.
    if (this.lastEyeY !== null) {
      const jumpUp = eyeY - this.lastEyeY;
      if (jumpUp > 0.3 && jumpUp < 1.1 && p.body.onGround) this.stepSmoothing -= jumpUp;
    }
    this.stepSmoothing += (0 - this.stepSmoothing) * damp(14, dt);
    this.lastEyeY = eyeY;
    eyeY += this.stepSmoothing;

    // View bobbing driven by distance walked.
    const walk = lerp(p.prevWalkDistance, p.walkDistance, alpha);
    const speed = Math.hypot(p.body.velocity.x, p.body.velocity.z);
    const moving = bobbing && p.body.onGround && !p.flying && speed > 0.5 ? Math.min(1, speed / 5.6) : 0;
    this.bobAmount += (moving - this.bobAmount) * damp(8, dt);
    const phase = walk * Math.PI * 0.6;
    const bobX = Math.sin(phase) * 0.045 * this.bobAmount;
    const bobY = Math.abs(Math.cos(phase)) * 0.07 * this.bobAmount;

    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    cam.position.set(x + cos * bobX, eyeY + bobY, z - sin * bobX);

    // Damage tilt and bob roll.
    const targetTilt = p.hurtTime > 0 ? Math.sin((p.hurtTime / 0.5) * Math.PI) * 0.08 : 0;
    this.tilt += (targetTilt - this.tilt) * damp(20, dt);
    cam.rotation.set(p.pitch + Math.abs(Math.cos(phase)) * 0.004 * this.bobAmount, p.yaw, Math.sin(phase) * 0.006 * this.bobAmount + this.tilt);

    // FOV: sprinting and fast flight widen the view.
    let target = fov;
    if (p.sprinting) target *= p.flying ? 1.15 : 1.1;
    if (p.eyeInWater) target *= 0.92;
    this.fov += (target - this.fov) * damp(10, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Current bob phase data for the held-item renderer.
   * @returns {{amount:number, phase:number}}
   */
  bobState() {
    return { amount: this.bobAmount, phase: this.player.walkDistance * Math.PI * 0.6 };
  }
}
