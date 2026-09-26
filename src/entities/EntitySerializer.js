import { ENTITY_TYPES } from './EntityTypes.js';
import { ItemEntity } from './ItemEntity.js';

/**
 * Converts persistent entities (farm animals and dropped items) to and from
 * plain JSON so they can be stored with their chunk. Hostile mobs, arrows
 * and falling blocks are transient and never saved.
 * @module entities/EntitySerializer
 */

/**
 * Whether an entity is saved with its chunk.
 * @param {import('./Entity.js').Entity} e
 * @returns {boolean}
 */
export function isPersistent(e) {
  if (e.removed || e.dead) return false;
  if (e.type === 'item') return true;
  return ENTITY_TYPES[e.type]?.category === 'passive';
}

/**
 * @param {import('./Entity.js').Entity} e
 * @returns {object}
 */
export function serializeEntity(e) {
  const base = { type: e.type, x: e.x, y: e.y, z: e.z, yaw: e.yaw };
  if (e.type === 'item') return { ...base, stack: { ...e.stack }, age: e.age };
  return { ...base, health: e.health };
}

/**
 * Recreates an entity from {@link serializeEntity} output.
 * @param {object} data
 * @param {import('./ai/Pathfinder.js').Pathfinder} pathfinder
 * @returns {import('./Entity.js').Entity|null}
 */
export function deserializeEntity(data, pathfinder) {
  if (!data || typeof data.type !== 'string') return null;
  let e;
  if (data.type === 'item') {
    if (!data.stack) return null;
    e = new ItemEntity(data.stack, 0);
    e.age = data.age ?? 0;
  } else {
    const info = ENTITY_TYPES[data.type];
    if (!info || !info.create) return null;
    e = info.create(pathfinder);
    if (Number.isFinite(data.health)) e.health = Math.max(1, Math.min(e.maxHealth, data.health));
  }
  e.setPosition(data.x, data.y, data.z);
  e.yaw = data.yaw ?? 0;
  return e;
}
