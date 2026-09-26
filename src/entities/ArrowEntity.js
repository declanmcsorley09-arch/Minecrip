import { Entity } from './Entity.js';
import { raycastVoxels } from '../physics/VoxelRaycast.js';

/**
 * Projectile fired by skeletons. Integrated with gravity and drag; hits are
 * detected by ray casting the segment travelled each tick against blocks
 * and player hitboxes, so fast arrows never tunnel through walls.
 */
export class ArrowEntity extends Entity {
  /**
   * @param {import('./Entity.js').Entity|null} shooter
   * @param {number} damage
   */
  constructor(shooter, damage) {
    super('arrow', { width: 0.2, height: 0.2, stepHeight: 0, gravity: 20 });
    this.shooterId = shooter ? shooter.id : 0;
    this.damage = damage;
    this.stuck = false;
    this.stuckTime = 0;
  }

  /** @override */
  tick(dt, ctx) {
    super.tick(dt, ctx);
    if (this.stuck) {
      this.stuckTime += dt;
      if (this.stuckTime > 8) this.remove();
      return;
    }
    const v = this.body.velocity;
    v.y -= 20 * dt;
    const drag = Math.exp(-0.2 * dt);
    v.x *= drag;
    v.y *= drag;
    v.z *= drag;
    const sx = this.x;
    const sy = this.y;
    const sz = this.z;
    const len = Math.hypot(v.x, v.y, v.z) * dt;
    if (len > 0) {
      const dx = (v.x * dt) / len;
      const dy = (v.y * dt) / len;
      const dz = (v.z * dt) / len;
      // Players.
      for (const p of ctx.players) {
        if (p.dead) continue;
        const hit = p.hitbox().raycast(sx, sy, sz, dx, dy, dz);
        if (hit && hit.t <= len) {
          ctx.damagePlayer(p, this.damage, this, 'arrow');
          this.remove();
          return;
        }
      }
      const blockHit = raycastVoxels(ctx.world, sx, sy, sz, dx, dy, dz, len);
      if (blockHit) {
        this.body.setPosition(blockHit.px - dx * 0.05, blockHit.py - dy * 0.05, blockHit.pz - dz * 0.05);
        this.stuck = true;
        v.x = 0;
        v.y = 0;
        v.z = 0;
        ctx.emitEvent(this, 'hit');
        return;
      }
    }
    this.body.setPosition(sx + v.x * dt, sy + v.y * dt, sz + v.z * dt);
    this.yaw = Math.atan2(-v.x, -v.z);
    this.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
    if (this.age > 20 || this.y < -10) this.remove();
  }
}
