import { Mob } from '../Mob.js';
import { WanderGoal, LookAtPlayerGoal, MeleeAttackGoal, RangedAttackGoal, SeekShadeGoal } from '../ai/Goals.js';
import { ArrowEntity } from '../ArrowEntity.js';

/**
 * Night-time monsters.
 * @module entities/mobs/HostileMobs
 */

export class Zombie extends Mob {
  /** @param {import('../ai/Pathfinder.js').Pathfinder} pathfinder */
  constructor(pathfinder) {
    super('zombie', { width: 0.6, height: 1.95 }, {
      health: 20,
      category: 'hostile',
      loot: [{ item: 'rotten_flesh', min: 0, max: 2 }],
    }, pathfinder);
    this.pathBudget = 900;
    this.goals.add(1, new SeekShadeGoal(this, 2.6));
    this.goals.add(2, new MeleeAttackGoal(this, 2.9, 3, 28));
    this.goals.add(6, new WanderGoal(this, 1.6, 0.08));
    this.lookGoals.add(1, new LookAtPlayerGoal(this, 10));
  }

  /** @override */
  burnsInDaylight() {
    return true;
  }
}

export class Skeleton extends Mob {
  /** @param {import('../ai/Pathfinder.js').Pathfinder} pathfinder */
  constructor(pathfinder) {
    super('skeleton', { width: 0.6, height: 1.99 }, {
      health: 20,
      category: 'hostile',
      loot: [
        { item: 'bone', min: 0, max: 2 },
        { item: 'arrow', min: 0, max: 2 },
      ],
    }, pathfinder);
    this.pathBudget = 800;
    this.goals.add(1, new SeekShadeGoal(this, 2.8));
    this.goals.add(2, new RangedAttackGoal(this, 2.6, 16, 2));
    this.goals.add(6, new WanderGoal(this, 1.6, 0.08));
    this.lookGoals.add(1, new LookAtPlayerGoal(this, 10));
  }

  /** @override */
  burnsInDaylight() {
    return true;
  }

  /**
   * Fires an arrow with a ballistic arc toward the target's chest.
   * @param {import('../Entity.js').EntityContext} ctx
   * @param {{x:number,y:number,z:number}} target
   */
  shootAt(ctx, target) {
    const arrow = new ArrowEntity(this, 2 + Math.floor(ctx.random() * 3));
    const ox = this.x;
    const oy = this.y + this.eyeHeight - 0.1;
    const oz = this.z;
    const dx = target.x - ox;
    const dz = target.z - oz;
    const horiz = Math.hypot(dx, dz);
    const dy = target.y + 1.2 - oy + horiz * 0.12; // aim slightly high to compensate for gravity
    const len = Math.hypot(dx, dy, dz) || 1;
    const speed = 22;
    const spread = 0.06;
    arrow.body.setPosition(ox + (dx / len) * 0.6, oy, oz + (dz / len) * 0.6);
    arrow.body.velocity.x = (dx / len + (ctx.random() - 0.5) * spread) * speed;
    arrow.body.velocity.y = (dy / len + (ctx.random() - 0.5) * spread) * speed;
    arrow.body.velocity.z = (dz / len + (ctx.random() - 0.5) * spread) * speed;
    ctx.entities.add(arrow);
    ctx.emitEvent(this, 'shoot');
  }
}
