import { Mob } from '../Mob.js';
import { WanderGoal, PanicGoal, LookAtPlayerGoal } from '../ai/Goals.js';

/**
 * Farm animals: wander, look at players, panic when hurt.
 * @module entities/mobs/PassiveMobs
 */

/**
 * Shared goal setup for animals.
 * @param {Mob} mob
 * @param {number} walk
 * @param {number} run
 */
function animalGoals(mob, walk, run) {
  mob.goals.add(1, new PanicGoal(mob, run));
  mob.goals.add(5, new WanderGoal(mob, walk));
  mob.lookGoals.add(1, new LookAtPlayerGoal(mob, 8));
}

export class Sheep extends Mob {
  /** @param {import('../ai/Pathfinder.js').Pathfinder} pathfinder */
  constructor(pathfinder) {
    super('sheep', { width: 0.9, height: 1.3 }, {
      health: 8,
      category: 'passive',
      loot: [
        { item: 'white_wool', min: 1, max: 1 },
        { item: 'raw_mutton', min: 1, max: 2 },
      ],
    }, pathfinder);
    animalGoals(this, 1.9, 3.2);
  }
}

export class Cow extends Mob {
  /** @param {import('../ai/Pathfinder.js').Pathfinder} pathfinder */
  constructor(pathfinder) {
    super('cow', { width: 0.9, height: 1.4 }, {
      health: 10,
      category: 'passive',
      loot: [
        { item: 'leather', min: 0, max: 2 },
        { item: 'raw_beef', min: 1, max: 3 },
      ],
    }, pathfinder);
    animalGoals(this, 1.7, 3.0);
  }
}

export class Pig extends Mob {
  /** @param {import('../ai/Pathfinder.js').Pathfinder} pathfinder */
  constructor(pathfinder) {
    super('pig', { width: 0.9, height: 0.9 }, {
      health: 10,
      category: 'passive',
      loot: [{ item: 'raw_porkchop', min: 1, max: 3 }],
    }, pathfinder);
    animalGoals(this, 1.9, 3.3);
  }
}
