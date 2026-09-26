import { EventEmitter } from '../utils/EventEmitter.js';
import { C2S, S2C, SERVER_TPS } from './Protocol.js';
import { lerp, lerpAngle } from '../utils/math.js';

/** How far behind the newest snapshot entities are rendered (seconds). */
const INTERP_DELAY = 0.1;
const MAX_BUFFER = 12;

/**
 * Client-side view of a server entity with a snapshot buffer for smooth
 * interpolation.
 */
export class RemoteEntity {
  /**
   * @param {import('./Protocol.js').EntitySnapshot} snap
   */
  constructor(snap) {
    this.id = snap.id;
    this.type = snap.t;
    /** @type {{t:number, x:number, y:number, z:number, yaw:number, pitch:number, f:number, d:object}[]} */
    this.buffer = [];
    this.x = snap.x;
    this.y = snap.y;
    this.z = snap.z;
    this.yaw = snap.yaw;
    this.pitch = snap.pitch;
    this.flags = snap.f;
    this.data = snap.d ?? {};
    /** Horizontal speed (blocks/s) for walk animations. */
    this.speed = 0;
    this.pickupRequested = 0;
  }

  /**
   * Adds a snapshot sample.
   * @param {number} t server time (seconds)
   * @param {import('./Protocol.js').EntitySnapshot} s
   */
  push(t, s) {
    this.buffer.push({ t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, f: s.f, d: s.d ?? {} });
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
  }

  /**
   * Interpolates the state for a render time.
   * @param {number} t server time to display
   */
  interpolate(t) {
    const b = this.buffer;
    if (b.length === 0) return;
    let a = b[0];
    let c = b[b.length - 1];
    if (t <= a.t) c = a;
    else if (t >= c.t) a = c;
    else {
      for (let i = 0; i < b.length - 1; i++) {
        if (b[i].t <= t && b[i + 1].t >= t) {
          a = b[i];
          c = b[i + 1];
          break;
        }
      }
    }
    const span = c.t - a.t;
    const k = span > 0 ? (t - a.t) / span : 1;
    const px = this.x;
    const pz = this.z;
    this.x = lerp(a.x, c.x, k);
    this.y = lerp(a.y, c.y, k);
    this.z = lerp(a.z, c.z, k);
    this.yaw = lerpAngle(a.yaw, c.yaw, k);
    this.pitch = lerp(a.pitch, c.pitch, k);
    this.flags = c.f;
    this.data = c.d;
    this.moved = Math.hypot(this.x - px, this.z - pz);
    if (span > 0) this.speed = Math.hypot(c.x - a.x, c.z - a.z) / span;
  }
}

/**
 * Client networking: sends predicted actions, applies server answers and
 * keeps remote entities interpolated.
 *
 * Events: welcome, health, died, respawn, pickup, chat, gameMode,
 * correction, entityEvent, entityRemoved, weather, time, blockRejected.
 */
export class GameClient extends EventEmitter {
  /**
   * @param {import('./Transport.js').Transport} transport
   * @param {object} opts
   * @param {import('../world/World.js').World} opts.world client world
   * @param {boolean} [opts.sharedWorld=false] world instance is shared with an integrated server
   */
  constructor(transport, { world, sharedWorld = false }) {
    super();
    this.transport = transport;
    this.world = world;
    this.sharedWorld = sharedWorld;
    this.playerId = 0;
    this.seq = 0;
    /** Predicted block edits awaiting acknowledgement. @type {Map<number, {x:number,y:number,z:number,prev:number}>} */
    this.pending = new Map();
    /** @type {Map<number, RemoteEntity>} */
    this.entities = new Map();
    this.serverTimeOffset = null;
    this.lastServerTime = 0;
    this.connected = false;
  }

  /**
   * Starts the handshake.
   * @param {string} name
   * @param {string} gameMode
   */
  connect(name, gameMode) {
    this.transport.send({ type: C2S.HELLO, name, gameMode, version: 1 });
  }

  /** @private */
  nextSeq() {
    return ++this.seq;
  }

  /**
   * Reports the local player's predicted state.
   * @param {object} state
   */
  sendPlayerState(state) {
    this.transport.send({ type: C2S.PLAYER_STATE, seq: this.nextSeq(), ...state });
  }

  /**
   * Requests breaking a block (predicted locally when not sharing the world).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} toolId held item id
   */
  breakBlock(x, y, z, toolId) {
    const seq = this.nextSeq();
    this.predict(seq, x, y, z, 0);
    this.transport.send({ type: C2S.BREAK_BLOCK, seq, x, y, z, toolId });
  }

  /**
   * Requests placing a block.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} id
   */
  placeBlock(x, y, z, id) {
    const seq = this.nextSeq();
    this.predict(seq, x, y, z, id);
    this.transport.send({ type: C2S.PLACE_BLOCK, seq, x, y, z, id });
  }

  /** @private */
  predict(seq, x, y, z, id) {
    if (this.sharedWorld) return;
    this.pending.set(seq, { x, y, z, prev: this.world.getBlock(x, y, z) });
    this.world.setBlock(x, y, z, id, { cause: 'player' });
  }

  /**
   * @param {number} entityId
   * @param {number} itemId
   * @param {boolean} sprinting
   */
  attack(entityId, itemId, sprinting) {
    this.transport.send({ type: C2S.ATTACK_ENTITY, entityId, itemId, sprinting });
  }

  /**
   * Drops a stack into the world.
   * @param {{id:number,count:number,damage:number}} stack
   * @param {{x:number,y:number,z:number}} pos
   * @param {{x:number,y:number,z:number}} vel
   */
  dropItem(stack, pos, vel) {
    this.transport.send({ type: C2S.DROP_ITEM, stack, x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z });
  }

  /**
   * Asks to collect an item entity.
   * @param {number} entityId
   * @param {number} max capacity available
   */
  requestPickup(entityId, max) {
    this.transport.send({ type: C2S.PICKUP, entityId, max });
  }

  /** @param {number} itemId */
  useItem(itemId) {
    this.transport.send({ type: C2S.USE_ITEM, itemId });
  }

  respawn() {
    this.transport.send({ type: C2S.RESPAWN });
  }

  /** @param {string} gameMode */
  setGameMode(gameMode) {
    this.transport.send({ type: C2S.SET_GAME_MODE, gameMode });
  }

  /** @param {string} text */
  chat(text) {
    this.transport.send({ type: C2S.CHAT, text });
  }

  /**
   * Current estimate of server time for interpolation.
   * @returns {number}
   */
  renderServerTime() {
    if (this.serverTimeOffset === null) return this.lastServerTime;
    return performance.now() / 1000 - this.serverTimeOffset - INTERP_DELAY;
  }

  /** Processes incoming messages and updates interpolation. */
  pump() {
    for (const msg of this.transport.receive()) this.handle(msg);
    const t = this.renderServerTime();
    for (const e of this.entities.values()) e.interpolate(t);
  }

  /** @private */
  handle(msg) {
    switch (msg.type) {
      case S2C.WELCOME:
        this.playerId = msg.playerId;
        this.connected = true;
        this.emit('welcome', msg);
        break;
      case S2C.ENTITY_SNAPSHOT:
        this.onSnapshot(msg);
        break;
      case S2C.ENTITY_REMOVE:
        for (const id of msg.ids) {
          const e = this.entities.get(id);
          if (e) {
            this.entities.delete(id);
            this.emit('entityRemoved', e);
          }
        }
        break;
      case S2C.ENTITY_EVENT:
        this.emit('entityEvent', msg);
        break;
      case S2C.BLOCK_ACK: {
        const p = this.pending.get(msg.seq);
        this.pending.delete(msg.seq);
        if (!msg.ok) {
          if (!this.sharedWorld && p) this.world.setBlock(msg.x, msg.y, msg.z, msg.id, { cause: 'server' });
          this.emit('blockRejected', msg);
        }
        break;
      }
      case S2C.BLOCK_UPDATE:
        if (!this.sharedWorld) this.world.setBlock(msg.x, msg.y, msg.z, msg.id, { cause: 'server' });
        break;
      case S2C.PLAYER_CORRECTION:
        this.emit('correction', msg);
        break;
      case S2C.PLAYER_HEALTH:
        this.emit('health', msg);
        break;
      case S2C.PLAYER_DIED:
        this.emit('died', msg);
        break;
      case S2C.PLAYER_RESPAWN:
        this.emit('respawn', msg);
        break;
      case S2C.ITEM_PICKUP:
        this.emit('pickup', msg);
        break;
      case S2C.TIME_SYNC:
        this.emit('time', msg);
        break;
      case S2C.WEATHER:
        this.emit('weather', msg);
        break;
      case S2C.CHAT:
        this.emit('chat', msg);
        break;
      case S2C.GAME_MODE:
        this.emit('gameMode', msg);
        break;
      case S2C.CHUNK_DATA:
        this.emit('chunkData', msg);
        break;
      default:
        break;
    }
  }

  /** @private */
  onSnapshot(msg) {
    const serverTime = msg.tick / SERVER_TPS;
    this.lastServerTime = serverTime;
    const sample = performance.now() / 1000 - serverTime;
    if (this.serverTimeOffset === null || sample < this.serverTimeOffset) this.serverTimeOffset = sample;
    else this.serverTimeOffset += (sample - this.serverTimeOffset) * 0.02;
    const seen = new Set();
    for (const s of msg.entities) {
      seen.add(s.id);
      let e = this.entities.get(s.id);
      if (!e) {
        e = new RemoteEntity(s);
        this.entities.set(s.id, e);
        this.emit('entityAdded', e);
      }
      e.push(serverTime, s);
    }
    // Entities missing from a full snapshot are gone.
    for (const [id, e] of this.entities) {
      if (!seen.has(id)) {
        this.entities.delete(id);
        this.emit('entityRemoved', e);
      }
    }
  }
}
