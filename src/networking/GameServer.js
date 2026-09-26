import { C2S, S2C, SERVER_TPS, PROTOCOL_VERSION } from './Protocol.js';
import { ServerPlayer } from './ServerPlayer.js';
import { EntityManager } from '../entities/EntityManager.js';
import { ItemEntity } from '../entities/ItemEntity.js';
import { FallingBlockEntity } from '../entities/FallingBlockEntity.js';
import { LivingEntity } from '../entities/LivingEntity.js';
import { Pathfinder } from '../entities/ai/Pathfinder.js';
import { MobSpawner } from '../entities/MobSpawner.js';
import { blockRegistry, BlockIds } from '../blocks/index.js';
import { canBlockStay } from '../blocks/BlockBehaviors.js';
import { itemRegistry } from '../items/index.js';
import { rollDrops } from '../items/Mining.js';
import { FurnaceState } from '../crafting/Furnace.js';
import { AABB } from '../physics/AABB.js';
import { runCommand } from './Commands.js';

/**
 * Authoritative game server.
 *
 * Owns world mutation, entity simulation (mobs, items, falling blocks,
 * arrows), mob spawning, furnaces, time, weather and player health. Clients
 * predict their own movement and block edits; the server validates every
 * request and answers with acknowledgements or corrections, and streams
 * entity snapshots at {@link SERVER_TPS} for client-side interpolation.
 *
 * Runs in-process as an integrated server for single-player (optionally
 * sharing the World instance with the client to avoid duplicating chunk
 * memory) and contains no rendering or DOM code, so it can run headless.
 */
export class GameServer {
  /**
   * @param {object} opts
   * @param {import('../world/World.js').World} opts.world
   * @param {import('../world/DayNightCycle.js').DayNightCycle} opts.cycle
   * @param {import('../world/Weather.js').Weather} opts.weather
   * @param {{x:number,y:number,z:number}} opts.spawn world spawn point
   * @param {object} [opts.rules] game rules
   */
  constructor({ world, cycle, weather, spawn, rules = {} }) {
    this.world = world;
    this.cycle = cycle;
    this.weather = weather;
    this.spawnPoint = { ...spawn };
    this.rules = { keepInventory: false, peaceful: false, mobSpawning: true, daylightCycle: true, weatherCycle: true, ...rules };
    this.entities = new EntityManager();
    this.pathfinder = new Pathfinder(world);
    this.spawner = new MobSpawner(this.pathfinder);
    /** @type {Map<number, ServerPlayer>} */
    this.players = new Map();
    /** @type {ServerPlayer[]} */
    this.playerList = [];
    this.nextPlayerId = 1;
    this.accumulator = 0;
    this.tickCount = 0;
    this.pendingEvents = [];
    this.lastWeatherType = weather.type;
    this.random = Math.random;
    this.tmpBox = new AABB();

    this.ctx = {
      world,
      entities: this.entities,
      cycle,
      random: this.random,
      players: this.playerList,
      dt: 1 / SERVER_TPS,
      spawnItem: (stack, x, y, z, vx, vy, vz, delay) => this.spawnItem(stack, x, y, z, vx, vy, vz, delay),
      damagePlayer: (p, amount, source, cause) => this.damagePlayer(p, amount, source, cause),
      emitEvent: (entity, event, data) => this.pendingEvents.push({ id: entity.id, event, data }),
      isRemoved: (p) => !p.connected || p.dead,
    };

    this.onBlockFall = ({ x, y, z, id }) => {
      const e = new FallingBlockEntity(id);
      e.setPosition(x + 0.5, y, z + 0.5);
      this.entities.add(e);
    };
    this.onBlockPopped = ({ x, y, z, id }) => {
      for (const drop of rollDrops(id, 0, this.random)) this.spawnItem(drop, x + 0.5, y + 0.3, z + 0.5);
    };
    this.onBlockChanged = (e) => this.broadcastBlock(e.x, e.y, e.z, e.id);
    world.on('blockFall', this.onBlockFall);
    world.on('blockPopped', this.onBlockPopped);
    world.on('blockChanged', this.onBlockChanged);
  }

  /**
   * Connects a client.
   * @param {import('./Transport.js').Transport} transport
   * @param {object} [opts]
   * @param {boolean} [opts.sharedWorld=false] client renders this server's World instance directly
   * @param {object} [opts.saved] persisted player state {x,y,z,yaw,pitch,health,gameMode,spawn}
   * @returns {ServerPlayer}
   */
  accept(transport, { sharedWorld = false, saved = null } = {}) {
    const p = new ServerPlayer(this.nextPlayerId++, 'Player', transport);
    p.sharedWorld = sharedWorld;
    p.spawn = saved?.spawn ?? { ...this.spawnPoint };
    const pos = saved ?? p.spawn;
    p.x = pos.x;
    p.y = pos.y;
    p.z = pos.z;
    p.yaw = saved?.yaw ?? 0;
    p.pitch = saved?.pitch ?? 0;
    if (saved) {
      p.health = saved.health ?? 20;
      p.gameMode = saved.gameMode ?? 'survival';
      p.air = saved.air ?? p.maxAir;
    }
    // The client places itself on the ground once terrain has loaded; accept that first move.
    p.trustNextMove = true;
    p.firstSpawn = !saved;
    this.players.set(p.id, p);
    this.playerList.push(p);
    transport.onClose = () => this.disconnect(p);
    return p;
  }

  /**
   * Removes a player.
   * @param {ServerPlayer} p
   */
  disconnect(p) {
    p.connected = false;
    this.players.delete(p.id);
    const i = this.playerList.indexOf(p);
    if (i >= 0) this.playerList.splice(i, 1);
  }

  /** Processes every queued client message. */
  pump() {
    for (const p of this.playerList) {
      const msgs = p.transport.receive();
      for (const msg of msgs) this.handle(p, msg);
    }
  }

  /**
   * Advances the server by real time, running fixed ticks.
   * @param {number} dt seconds
   */
  update(dt) {
    this.pump();
    this.accumulator += Math.min(dt, 0.25);
    const step = 1 / SERVER_TPS;
    while (this.accumulator >= step) {
      this.accumulator -= step;
      this.tick(step);
    }
  }

  /**
   * One server tick.
   * @param {number} dt
   */
  tick(dt) {
    this.tickCount++;
    this.ctx.dt = dt;
    if (this.rules.daylightCycle) this.cycle.update(dt);
    this.weather.cycle = this.rules.weatherCycle;
    this.weather.update(dt);
    this.world.tick();
    this.tickFurnaces(dt);
    this.entities.tick(dt, this.ctx);
    this.spawner.enabled = this.rules.mobSpawning;
    this.spawner.tick(dt, this.ctx, this.rules);
    for (const p of this.playerList) this.tickPlayer(p, dt);
    this.broadcastState();
  }

  /** @private */
  tickFurnaces(dt) {
    const toggles = [];
    this.world.forEachBlockEntity((be, x, y, z, chunk) => {
      if (!(be instanceof FurnaceState)) return;
      const wasLit = be.lit;
      if (be.tick(dt)) {
        chunk.dirty = true;
        if (wasLit !== be.lit) toggles.push({ x, y, z, lit: be.lit });
      }
    });
    for (const { x, y, z, lit } of toggles) {
      const id = this.world.getBlock(x, y, z);
      const facing = blockRegistry.get(id).variantData.facing ?? 'north';
      const next = lit ? BlockIds[`lit_furnace_${facing}`] : facing === 'north' ? BlockIds.furnace : BlockIds[`furnace_${facing}`];
      if (next && next !== id) this.world.setBlock(x, y, z, next, { notify: false, cause: 'furnace' });
    }
  }

  /** @private */
  tickPlayer(p, dt) {
    if (p.dead) return;
    if (p.hurtCooldown > 0) p.hurtCooldown -= dt;
    // Natural regeneration.
    if (p.health < p.maxHealth) {
      p.regenTimer += dt;
      if (p.regenTimer >= 4) {
        p.regenTimer = 0;
        p.health = Math.min(p.maxHealth, p.health + 1);
        this.sendHealth(p, null);
      }
    } else p.regenTimer = 0;
    // Drowning.
    const prevAir = p.air;
    if (p.eyeInWater && p.gameMode === 'survival') {
      p.air = Math.max(0, p.air - dt);
      if (p.air <= 0) {
        p.drownTimer += dt;
        if (p.drownTimer >= 1) {
          p.drownTimer = 0;
          this.damagePlayer(p, 2, null, 'drowning');
        }
      }
    } else {
      p.air = Math.min(p.maxAir, p.air + dt * 6);
      p.drownTimer = 0;
    }
    if (Math.floor(prevAir * 2) !== Math.floor(p.air * 2)) this.sendHealth(p, null);
    // Falling out of the world.
    if (p.y < -40) this.damagePlayer(p, 4, null, 'void', true);
  }

  /**
   * Spawns a dropped item entity.
   * @returns {ItemEntity}
   */
  spawnItem(stack, x, y, z, vx, vy, vz, delay = 0.5) {
    const e = new ItemEntity(stack, delay);
    e.setPosition(x, y, z);
    e.body.velocity.x = vx ?? (this.random() - 0.5) * 2.5;
    e.body.velocity.y = vy ?? 3;
    e.body.velocity.z = vz ?? (this.random() - 0.5) * 2.5;
    this.entities.add(e);
    return e;
  }

  /**
   * Applies damage to a player (server authoritative).
   * @param {ServerPlayer} p
   * @param {number} amount
   * @param {{x:number,z:number}|null} source
   * @param {string} cause
   * @param {boolean} [ignoreCooldown=false]
   */
  damagePlayer(p, amount, source, cause, ignoreCooldown = false) {
    if (p.dead || !p.connected || p.gameMode !== 'survival') return;
    if (p.hurtCooldown > 0 && !ignoreCooldown) return;
    p.hurtCooldown = 0.5;
    p.health = Math.max(0, p.health - amount);
    let kb = null;
    if (source) {
      const dx = p.x - source.x;
      const dz = p.z - source.z;
      const len = Math.hypot(dx, dz) || 1;
      kb = { x: (dx / len) * 7, y: 5.5, z: (dz / len) * 7 };
    }
    this.sendHealth(p, cause, kb);
    if (p.health <= 0) {
      p.dead = true;
      p.send({ type: S2C.PLAYER_DIED, cause });
      this.broadcast({ type: S2C.CHAT, text: deathMessage(p.name, cause), color: '#ff7070' });
    }
  }

  /** @private */
  sendHealth(p, cause, kb = null) {
    p.send({
      type: S2C.PLAYER_HEALTH,
      health: p.health,
      maxHealth: p.maxHealth,
      air: p.air,
      maxAir: p.maxAir,
      cause,
      kbx: kb ? kb.x : 0,
      kby: kb ? kb.y : 0,
      kbz: kb ? kb.z : 0,
    });
  }

  /** @private */
  broadcastState() {
    const snapshots = [];
    for (const e of this.entities.entities.values()) snapshots.push(e.snapshot());
    const removed = this.entities.drainRemoved();
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const weatherChanged = this.weather.type !== this.lastWeatherType || this.weather.lightningStruck;
    this.lastWeatherType = this.weather.type;
    for (const p of this.playerList) {
      p.send({ type: S2C.ENTITY_SNAPSHOT, tick: this.tickCount, time: this.cycle.time, entities: snapshots });
      if (removed.length) p.send({ type: S2C.ENTITY_REMOVE, ids: removed });
      for (const ev of events) p.send({ type: S2C.ENTITY_EVENT, ...ev });
      if (weatherChanged) p.send({ type: S2C.WEATHER, weather: this.weather.type, lightning: this.weather.lightningStruck });
      if (this.tickCount % 100 === 0) p.send({ type: S2C.TIME_SYNC, time: this.cycle.time });
    }
  }

  /**
   * Sends a message to every player.
   * @param {object} msg
   */
  broadcast(msg) {
    for (const p of this.playerList) p.send(msg);
  }

  /** @private */
  broadcastBlock(x, y, z, id) {
    for (const p of this.playerList) if (!p.sharedWorld) p.send({ type: S2C.BLOCK_UPDATE, x, y, z, id });
  }

  /**
   * Routes a client message.
   * @param {ServerPlayer} p
   * @param {object} msg
   */
  handle(p, msg) {
    switch (msg.type) {
      case C2S.HELLO:
        this.onHello(p, msg);
        break;
      case C2S.PLAYER_STATE:
        this.onPlayerState(p, msg);
        break;
      case C2S.BREAK_BLOCK:
        this.onBreakBlock(p, msg);
        break;
      case C2S.PLACE_BLOCK:
        this.onPlaceBlock(p, msg);
        break;
      case C2S.ATTACK_ENTITY:
        this.onAttack(p, msg);
        break;
      case C2S.DROP_ITEM:
        this.onDropItem(p, msg);
        break;
      case C2S.PICKUP:
        this.onPickup(p, msg);
        break;
      case C2S.USE_ITEM:
        this.onUseItem(p, msg);
        break;
      case C2S.RESPAWN:
        this.onRespawn(p);
        break;
      case C2S.SET_GAME_MODE:
        this.setGameMode(p, msg.gameMode);
        break;
      case C2S.CHAT:
        this.onChat(p, msg);
        break;
      case C2S.CHUNK_REQUEST:
        this.onChunkRequest(p, msg);
        break;
      default:
        break;
    }
  }

  /** @private */
  onHello(p, msg) {
    if (msg.name) p.name = String(msg.name).slice(0, 16);
    if (msg.gameMode === 'creative' || msg.gameMode === 'survival') p.gameMode = msg.gameMode;
    p.send({
      type: S2C.WELCOME,
      version: PROTOCOL_VERSION,
      playerId: p.id,
      seed: this.world.seed,
      time: this.cycle.time,
      weather: this.weather.type,
      spawn: p.spawn,
      position: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch },
      gameMode: p.gameMode,
      health: p.health,
      air: p.air,
    });
  }

  /** @private */
  onPlayerState(p, msg) {
    if (p.dead) return;
    const now = this.tickCount / SERVER_TPS;
    const elapsed = Math.max(0.05, now - p.lastMoveTime);
    const dx = msg.x - p.x;
    const dy = msg.y - p.y;
    const dz = msg.z - p.z;
    const dist = Math.hypot(dx, dz);
    const maxSpeed = p.gameMode === 'creative' || msg.flying ? 50 : 16;
    if (p.trustNextMove) {
      p.trustNextMove = false;
      if (p.firstSpawn) {
        p.firstSpawn = false;
        p.spawn = { x: msg.x, y: msg.y, z: msg.z };
      }
    } else if (dist > maxSpeed * elapsed + 3 || Math.abs(dy) > 90 * elapsed + 4) {
      p.send({ type: S2C.PLAYER_CORRECTION, seq: msg.seq, x: p.x, y: p.y, z: p.z });
      return;
    }
    p.lastMoveTime = now;
    p.lastSeq = msg.seq;
    p.x = msg.x;
    p.y = msg.y;
    p.z = msg.z;
    p.yaw = msg.yaw;
    p.pitch = msg.pitch;
    p.sneaking = !!msg.sneaking;
    p.flying = !!msg.flying;
    p.inWater = !!msg.inWater;
    p.eyeInWater = !!msg.eyeInWater;
    const wasOnGround = p.onGround;
    p.onGround = !!msg.onGround;

    // Fall damage from the highest point since leaving the ground.
    if (p.inWater || p.flying || p.gameMode !== 'survival') p.fallPeakY = null;
    else if (!p.onGround) p.fallPeakY = Math.max(p.fallPeakY ?? p.y, p.y);
    else if (!wasOnGround || p.fallPeakY !== null) {
      if (p.fallPeakY !== null) {
        const fall = p.fallPeakY - p.y;
        if (fall > 3.4) this.damagePlayer(p, Math.floor(fall - 3), null, 'fall', true);
      }
      p.fallPeakY = null;
    }
  }

  /**
   * Reach check from the player's eyes to a block centre.
   * @private
   */
  inReach(p, x, y, z) {
    const reach = p.gameMode === 'creative' ? 7 : 6;
    const ex = p.x;
    const ey = p.y + 1.62;
    const ez = p.z;
    return (x + 0.5 - ex) ** 2 + (y + 0.5 - ey) ** 2 + (z + 0.5 - ez) ** 2 <= reach * reach;
  }

  /** @private */
  reject(p, msg) {
    p.send({ type: S2C.BLOCK_ACK, seq: msg.seq, ok: false, x: msg.x, y: msg.y, z: msg.z, id: this.world.getBlock(msg.x, msg.y, msg.z) });
  }

  /** @private */
  onBreakBlock(p, msg) {
    const { x, y, z } = msg;
    const id = this.world.getBlock(x, y, z);
    const def = blockRegistry.get(id);
    const valid = !p.dead && this.world.isLoaded(x, z) && id !== 0 && !def.fluid && this.inReach(p, x, y, z) && (def.hardness >= 0 || p.gameMode === 'creative');
    if (!valid) {
      this.reject(p, msg);
      return;
    }
    const be = this.world.getBlockEntity(x, y, z);
    this.world.setBlock(x, y, z, 0, { cause: 'player' });
    if (p.gameMode === 'survival') {
      for (const drop of rollDrops(id, msg.toolId ?? 0, this.random)) this.spawnItem(drop, x + 0.5, y + 0.3, z + 0.5);
      if (be instanceof FurnaceState) {
        for (const s of [be.input, be.fuel, be.output]) if (s) this.spawnItem(s.toJSON(), x + 0.5, y + 0.5, z + 0.5);
      }
    }
    this.pendingEvents.push({ id: 0, event: 'block_break', data: { x, y, z, block: id, player: p.id } });
    p.send({ type: S2C.BLOCK_ACK, seq: msg.seq, ok: true, x, y, z, id: 0 });
  }

  /** @private */
  onPlaceBlock(p, msg) {
    const { x, y, z, id } = msg;
    const def = blockRegistry.byId[id];
    const cur = this.world.getBlock(x, y, z);
    let valid = !!def && id !== 0 && !p.dead && this.world.isLoaded(x, z) && y >= 0 && y < 256 && this.inReach(p, x, y, z);
    valid = valid && (cur === 0 || blockRegistry.replaceable[cur] === 1) && cur !== id;
    valid = valid && canBlockStay(this.world, x, y, z, id);
    if (valid && def.collision) {
      const c = def.collision;
      const box = this.tmpBox.set(x + c[0], y + c[1], z + c[2], x + c[3], y + c[4], z + c[5]);
      for (const other of this.playerList) if (!other.dead && other.hitbox().intersects(box)) valid = false;
      for (const e of this.entities.query(x + 0.5, y + 0.5, z + 0.5, 3)) {
        if (e instanceof LivingEntity && !e.dead && e.body.box.intersects(box)) valid = false;
      }
    }
    if (!valid) {
      this.reject(p, msg);
      return;
    }
    this.world.setBlock(x, y, z, id, { cause: 'player' });
    if (def.interaction === 'furnace' && !this.world.getBlockEntity(x, y, z)) this.world.setBlockEntity(x, y, z, new FurnaceState());
    this.pendingEvents.push({ id: 0, event: 'block_place', data: { x, y, z, block: id, player: p.id } });
    p.send({ type: S2C.BLOCK_ACK, seq: msg.seq, ok: true, x, y, z, id });
  }

  /** @private */
  onAttack(p, msg) {
    const e = this.entities.get(msg.entityId);
    if (!e || !(e instanceof LivingEntity) || e.dead || p.dead) return;
    if (e.distanceSq(p.x, p.y + 1, p.z) > 5 * 5) return;
    const tool = itemRegistry.get(msg.itemId)?.tool;
    const damage = tool ? tool.damage : 1;
    const knock = msg.sprinting ? 1.6 : 1;
    e.hurt(damage, this.ctx, { x: p.x, z: p.z }, knock);
  }

  /** @private */
  onDropItem(p, msg) {
    const s = msg.stack;
    if (!s || !itemRegistry.get(s.id) || !(s.count > 0)) return;
    this.spawnItem({ id: s.id, count: Math.min(64, s.count), damage: s.damage ?? 0 }, msg.x, msg.y, msg.z, msg.vx, msg.vy, msg.vz, 1.5);
  }

  /** @private */
  onPickup(p, msg) {
    const e = this.entities.get(msg.entityId);
    if (!e || e.type !== 'item' || e.removed || p.dead || e.pickupDelay > 0) return;
    if (e.distanceSq(p.x, p.y + 0.8, p.z) > 3 * 3) return;
    const n = Math.min(e.stack.count, Math.max(0, msg.max | 0));
    if (n <= 0) return;
    e.stack.count -= n;
    if (e.stack.count <= 0) e.remove();
    p.send({ type: S2C.ITEM_PICKUP, entityId: e.id, stack: { id: e.stack.id, count: n, damage: e.stack.damage } });
    this.pendingEvents.push({ id: e.id, event: 'pickup', data: { player: p.id } });
  }

  /** @private */
  onUseItem(p, msg) {
    const food = itemRegistry.get(msg.itemId)?.food;
    if (!food || p.dead) return;
    p.health = Math.min(p.maxHealth, p.health + food.heal);
    this.sendHealth(p, null);
  }

  /** @private */
  onRespawn(p) {
    if (!p.dead) return;
    p.dead = false;
    p.health = p.maxHealth;
    p.air = p.maxAir;
    p.fallPeakY = null;
    p.x = p.spawn.x;
    p.y = p.spawn.y;
    p.z = p.spawn.z;
    p.trustNextMove = true;
    p.send({ type: S2C.PLAYER_RESPAWN, x: p.x, y: p.y, z: p.z, health: p.health });
  }

  /**
   * Changes a player's game mode.
   * @param {ServerPlayer} p
   * @param {string} mode
   */
  setGameMode(p, mode) {
    if (mode !== 'survival' && mode !== 'creative') return;
    p.gameMode = mode;
    p.fallPeakY = null;
    p.send({ type: S2C.GAME_MODE, gameMode: mode });
  }

  /** @private */
  onChat(p, msg) {
    const text = String(msg.text ?? '').slice(0, 256).trim();
    if (!text) return;
    if (text.startsWith('/')) {
      const reply = runCommand(this, p, text.slice(1));
      if (reply) p.send({ type: S2C.CHAT, text: reply.text, color: reply.error ? '#ff7070' : '#a0e0ff' });
      return;
    }
    this.broadcast({ type: S2C.CHAT, text: `<${p.name}> ${text}` });
  }

  /** @private */
  onChunkRequest(p, msg) {
    const chunk = this.world.getChunk(msg.cx, msg.cz);
    const mods = [];
    if (chunk) for (const [idx, id] of chunk.modifications) mods.push((idx << 8) | id);
    p.send({ type: S2C.CHUNK_DATA, cx: msg.cx, cz: msg.cz, mods });
  }

  /**
   * Snapshot of a player for saving.
   * @param {ServerPlayer} p
   * @returns {object}
   */
  savePlayer(p) {
    return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health, air: p.air, gameMode: p.gameMode, spawn: p.spawn };
  }

  /** Detaches world listeners and drops all entities. */
  dispose() {
    this.world.off('blockFall', this.onBlockFall);
    this.world.off('blockPopped', this.onBlockPopped);
    this.world.off('blockChanged', this.onBlockChanged);
    this.entities.clear();
    for (const p of [...this.playerList]) this.disconnect(p);
  }
}

/**
 * Human readable death message.
 * @param {string} name
 * @param {string} cause
 * @returns {string}
 */
function deathMessage(name, cause) {
  switch (cause) {
    case 'fall':
      return `${name} hit the ground too hard`;
    case 'drowning':
      return `${name} drowned`;
    case 'void':
      return `${name} fell out of the world`;
    case 'zombie':
      return `${name} was slain by a Zombie`;
    case 'arrow':
      return `${name} was shot by a Skeleton`;
    case 'kill':
      return `${name} died`;
    default:
      return `${name} died`;
  }
}
