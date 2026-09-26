import { Sheep, Cow, Pig } from './mobs/PassiveMobs.js';
import { Zombie, Skeleton } from './mobs/HostileMobs.js';

/**
 * Entity type metadata shared by server (spawning) and client (rendering).
 * @module entities/EntityTypes
 */

/**
 * @typedef {object} EntityTypeInfo
 * @property {string} name
 * @property {string} displayName
 * @property {number} width
 * @property {number} height
 * @property {'passive'|'hostile'|'misc'} category
 * @property {(pathfinder: import('./ai/Pathfinder.js').Pathfinder) => import('./Mob.js').Mob} [create]
 */

/** @type {Record<string, EntityTypeInfo>} */
export const ENTITY_TYPES = {
  sheep: { name: 'sheep', displayName: 'Sheep', width: 0.9, height: 1.3, category: 'passive', create: (p) => new Sheep(p) },
  cow: { name: 'cow', displayName: 'Cow', width: 0.9, height: 1.4, category: 'passive', create: (p) => new Cow(p) },
  pig: { name: 'pig', displayName: 'Pig', width: 0.9, height: 0.9, category: 'passive', create: (p) => new Pig(p) },
  zombie: { name: 'zombie', displayName: 'Zombie', width: 0.6, height: 1.95, category: 'hostile', create: (p) => new Zombie(p) },
  skeleton: { name: 'skeleton', displayName: 'Skeleton', width: 0.6, height: 1.99, category: 'hostile', create: (p) => new Skeleton(p) },
  item: { name: 'item', displayName: 'Item', width: 0.25, height: 0.25, category: 'misc' },
  falling_block: { name: 'falling_block', displayName: 'Falling Block', width: 0.98, height: 0.98, category: 'misc' },
  arrow: { name: 'arrow', displayName: 'Arrow', width: 0.2, height: 0.2, category: 'misc' },
};

/** Mob types that spawn naturally, by category. */
export const SPAWNABLE = {
  passive: ['sheep', 'cow', 'pig'],
  hostile: ['zombie', 'skeleton'],
};
