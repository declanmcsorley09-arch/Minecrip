import { Entity } from './Entity.js';
import { blockRegistry } from '../blocks/index.js';
import { itemRegistry } from '../items/index.js';

/**
 * A gravity block (sand, gravel) in free fall. Lands as a block again, or
 * breaks into an item if the landing spot is occupied.
 */
export class FallingBlockEntity extends Entity {
  /**
   * @param {number} blockId
   */
  constructor(blockId) {
    super('falling_block', { width: 0.98, height: 0.98, stepHeight: 0, gravity: 32 });
    this.blockId = blockId;
  }

  /** @override */
  tick(dt, ctx) {
    super.tick(dt, ctx);
    const v = this.body.velocity;
    v.x = 0;
    v.z = 0;
    this.body.step(ctx.world, dt, { stepUp: false });
    if (this.y < -10 || this.age > 30) {
      this.remove();
      return;
    }
    if (this.body.onGround) {
      const bx = Math.floor(this.x);
      const by = Math.floor(this.y + 0.1);
      const bz = Math.floor(this.z);
      const cur = ctx.world.getBlock(bx, by, bz);
      if (cur === 0 || blockRegistry.replaceable[cur]) {
        ctx.world.setBlock(bx, by, bz, this.blockId, { cause: 'fall' });
      } else {
        const itemId = itemRegistry.itemForBlock(this.blockId);
        if (itemId) ctx.spawnItem({ id: itemId, count: 1 }, this.x, this.y + 0.2, this.z);
      }
      this.remove();
    }
  }

  /** @override */
  snapshotData() {
    return { b: this.blockId };
  }

  /** @override */
  canDespawn() {
    return false;
  }
}
