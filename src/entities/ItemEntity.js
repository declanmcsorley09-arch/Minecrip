import { Entity } from './Entity.js';

/**
 * A dropped item stack lying in the world. Merges with nearby identical
 * stacks, can be picked up after a short delay and despawns after five
 * minutes.
 */
export class ItemEntity extends Entity {
  /**
   * @param {{id:number, count:number, damage?:number}} stack
   * @param {number} [pickupDelay=0.5] seconds before it can be collected
   */
  constructor(stack, pickupDelay = 0.5) {
    super('item', { width: 0.25, height: 0.25, stepHeight: 0, gravity: 24, fluidGravity: -2, fluidDrag: 3 });
    this.stack = { id: stack.id, count: stack.count, damage: stack.damage ?? 0 };
    this.pickupDelay = pickupDelay;
    this.mergeTimer = 0;
    this.lifetime = 300;
  }

  /** @override */
  tick(dt, ctx) {
    super.tick(dt, ctx);
    if (this.pickupDelay > 0) this.pickupDelay -= dt;
    const v = this.body.velocity;
    const friction = this.body.onGround ? Math.exp(-8 * dt) : Math.exp(-0.5 * dt);
    v.x *= friction;
    v.z *= friction;
    this.body.step(ctx.world, dt, { stepUp: false });
    if (this.age > this.lifetime || this.y < -20) this.remove();

    this.mergeTimer -= dt;
    if (this.mergeTimer <= 0 && !this.removed) {
      this.mergeTimer = 1;
      for (const other of ctx.entities.query(this.x, this.y, this.z, 1.5)) {
        if (other === this || other.type !== 'item' || other.removed) continue;
        if (other.stack.id !== this.stack.id || other.stack.damage !== this.stack.damage) continue;
        if (other.stack.count + this.stack.count > 64) continue;
        this.stack.count += other.stack.count;
        this.age = Math.min(this.age, other.age);
        other.remove();
      }
    }
  }

  /** @override */
  snapshotData() {
    return { id: this.stack.id, c: this.stack.count };
  }
}
