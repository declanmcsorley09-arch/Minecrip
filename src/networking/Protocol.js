/**
 * Client ⇄ server message definitions.
 *
 * Messages are plain JSON-compatible objects `{ type, ...fields }` so they
 * can travel over an in-process {@link LocalTransport} (integrated
 * single-player server) or a WebSocket to a dedicated server unchanged.
 * @module networking/Protocol
 */

/** Protocol version; bump on incompatible changes. */
export const PROTOCOL_VERSION = 1;

/** Server simulation rate (ticks per second). */
export const SERVER_TPS = 20;

/** Rate at which clients report their player state. */
export const CLIENT_STATE_RATE = 20;

export const C2S = Object.freeze({
  /** {name, version, gameMode} */
  HELLO: 'hello',
  /** {seq, x, y, z, vx, vy, vz, yaw, pitch, onGround, sneaking, sprinting, flying, inWater, eyeInWater} */
  PLAYER_STATE: 'player_state',
  /** {seq, x, y, z, toolId} */
  BREAK_BLOCK: 'break_block',
  /** {seq, x, y, z, id} */
  PLACE_BLOCK: 'place_block',
  /** {entityId, itemId} */
  ATTACK_ENTITY: 'attack_entity',
  /** {stack:{id,count,damage}, x, y, z, vx, vy, vz} */
  DROP_ITEM: 'drop_item',
  /** {entityId, max} */
  PICKUP: 'pickup',
  /** {itemId} */
  USE_ITEM: 'use_item',
  /** {} */
  RESPAWN: 'respawn',
  /** {gameMode} */
  SET_GAME_MODE: 'set_game_mode',
  /** {text} */
  CHAT: 'chat',
  /** {cx, cz} request chunk modifications (remote clients) */
  CHUNK_REQUEST: 'chunk_request',
});

export const S2C = Object.freeze({
  /** {playerId, seed, time, weather, spawn, gameMode, health} */
  WELCOME: 'welcome',
  /** {x, y, z, id} authoritative block change */
  BLOCK_UPDATE: 'block_update',
  /** {seq, ok, x, y, z, id} response to a predicted block action */
  BLOCK_ACK: 'block_ack',
  /** {tick, time, entities: EntitySnapshot[]} */
  ENTITY_SNAPSHOT: 'entity_snapshot',
  /** {ids: number[]} */
  ENTITY_REMOVE: 'entity_remove',
  /** {id, event, data} one-shot entity events (hurt, death, attack, shoot...) */
  ENTITY_EVENT: 'entity_event',
  /** {seq, x, y, z} server rejected the reported position */
  PLAYER_CORRECTION: 'player_correction',
  /** {health, maxHealth, air, cause, kbx, kby, kbz} */
  PLAYER_HEALTH: 'player_health',
  /** {cause} */
  PLAYER_DIED: 'player_died',
  /** {x, y, z, health} */
  PLAYER_RESPAWN: 'player_respawn',
  /** {entityId, stack:{id,count,damage}} */
  ITEM_PICKUP: 'item_pickup',
  /** {time} */
  TIME_SYNC: 'time_sync',
  /** {type, rain, thunder, lightning} */
  WEATHER: 'weather',
  /** {text, color} */
  CHAT: 'chat',
  /** {cx, cz, mods: number[], blockEntities} */
  CHUNK_DATA: 'chunk_data',
  /** {gameMode} */
  GAME_MODE: 'game_mode',
});

/**
 * @typedef {object} EntitySnapshot
 * @property {number} id
 * @property {string} t entity type
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} yaw
 * @property {number} pitch
 * @property {number} f flags (see EntityFlags)
 * @property {object} [d] type specific data (item stack, block id, health...)
 */

/** Bit flags carried in entity snapshots. */
export const EntityFlags = Object.freeze({
  HURT: 1,
  DEAD: 2,
  ON_GROUND: 4,
  BURNING: 8,
  ATTACKING: 16,
  IN_WATER: 32,
});

/**
 * Serialises a message for byte-oriented transports.
 * @param {object} msg
 * @returns {string}
 */
export function encodeMessage(msg) {
  return JSON.stringify(msg);
}

/**
 * Parses a message received from a byte-oriented transport.
 * @param {string} data
 * @returns {object|null}
 */
export function decodeMessage(data) {
  try {
    const msg = JSON.parse(data);
    return msg && typeof msg.type === 'string' ? msg : null;
  } catch {
    return null;
  }
}
