import * as THREE from 'three';
import { EventEmitter } from '../utils/EventEmitter.js';
import { GameLoop } from './GameLoop.js';
import { Renderer } from '../renderer/Renderer.js';
import { ChunkMaterials } from '../renderer/ChunkMaterials.js';
import { ChunkRenderer } from '../renderer/ChunkRenderer.js';
import { SkyRenderer } from '../renderer/SkyRenderer.js';
import { CloudRenderer } from '../renderer/CloudRenderer.js';
import { WeatherRenderer } from '../renderer/WeatherRenderer.js';
import { Atmosphere } from '../renderer/Atmosphere.js';
import { ParticleSystem } from '../renderer/ParticleSystem.js';
import { BlockHighlight } from '../renderer/BlockHighlight.js';
import { EntityRenderer } from '../renderer/EntityRenderer.js';
import { HeldItemRenderer } from '../renderer/HeldItemRenderer.js';
import { World } from '../world/World.js';
import { ChunkStreamer } from '../world/ChunkStreamer.js';
import { DayNightCycle } from '../world/DayNightCycle.js';
import { Weather } from '../world/Weather.js';
import { WorkerPool } from '../workers/WorkerPool.js';
import { TerrainGenerator } from '../terrain/TerrainGenerator.js';
import { BIOMES } from '../terrain/Biomes.js';
import { GameServer } from '../networking/GameServer.js';
import { GameClient } from '../networking/GameClient.js';
import { createLocalTransportPair } from '../networking/LocalTransport.js';
import { CLIENT_STATE_RATE } from '../networking/Protocol.js';
import { Player } from '../player/Player.js';
import { PlayerController } from '../player/PlayerController.js';
import { CameraController } from '../player/CameraController.js';
import { BlockInteraction } from '../player/BlockInteraction.js';
import { ItemPickup } from '../player/ItemPickup.js';
import { ItemStack } from '../inventory/ItemStack.js';
import { WorldStorage } from '../save/WorldStorage.js';
import { GameAudio } from '../audio/GameAudio.js';
import { AmbientAudio } from '../audio/AmbientAudio.js';
import { MusicSystem } from '../audio/MusicSystem.js';
import { blockRegistry } from '../blocks/index.js';
import { itemRegistry } from '../items/index.js';
import { InputManager } from '../player/InputManager.js';
import { Profiler } from '../utils/Profiler.js';

const FIXED_DT = 1 / 60;
const SHADOW_SIZES = { low: 1024, medium: 2048, high: 4096 };

/**
 * A running game session (client side) with an integrated server.
 *
 * Owns the renderer, world, chunk streaming and meshing workers, the
 * integrated {@link GameServer} and the {@link GameClient} talking to it,
 * the local player systems, audio and autosave. The UI observes it through
 * events: `ready`, `progress`, `pause`, `resume`, `died`, `respawned`,
 * `health`, `chat`, `openContainer`, `openInventory`, `gameMode`, `itemPicked`.
 */
export class Game extends EventEmitter {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {import('../settings/Settings.js').Settings} opts.settings
   * @param {import('../audio/AudioEngine.js').AudioEngine|null} opts.audio
   * @param {import('../save/Database.js').Database|null} opts.db
   * @param {object} opts.meta world record (id, name, seed, gameMode, time, weather, player, rules)
   * @param {import('../renderer/textures/BlockTextureArray.js').BlockTextureArray} opts.blockTextures shared block textures
   * @param {import('../renderer/ItemIcons.js').ItemIcons} opts.icons shared item icons
   * @param {InputManager} [opts.input]
   */
  constructor({ canvas, settings, audio, db, meta, blockTextures, icons, input }) {
    super();
    this.blockTextures = blockTextures;
    this.icons = icons;
    this.canvas = canvas;
    this.settings = settings;
    this.audio = audio;
    this.db = db;
    this.meta = meta;
    this.input = input ?? new InputManager(canvas, settings);
    this.ownsInput = !input;
    this.paused = true;
    this.ready = false;
    this.disposed = false;
    this.accumulator = 0;
    this.stateTimer = 0;
    this.autosaveTimer = 0;
    this.time = 0;
    this.pendingLightning = false;
    this.hideHand = false;
    this.lookDir = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.sunFocus = new THREE.Vector3();
    this.loop = new GameLoop((dt) => this.frame(dt));
    this.profiler = new Profiler();
    this.settingsListener = (key, value) => this.applySetting(key, value);
  }

  /**
   * Builds every subsystem and starts loading the spawn area.
   * @returns {Promise<void>} resolves once the player can spawn
   */
  async start() {
    const s = this.settings;
    const meta = this.meta;
    this.renderer = new Renderer(this.canvas, {
      fov: s.get('fov'),
      pixelRatio: Math.min(2, window.devicePixelRatio || 1) * s.get('renderScale'),
      shadows: s.get('shadows'),
      shadowMapSize: SHADOW_SIZES[s.get('shadowQuality')],
    });
    this.blockTextures.upload(this.renderer.webgl);
    this.materials = new ChunkMaterials(this.blockTextures.texture);

    // World + streaming.
    this.world = new World(meta.seed);
    const cores = navigator.hardwareConcurrency || 4;
    const workerCount = Math.max(1, Math.min(4, Math.floor((cores - 1) / 2)));
    const factory = () => new Worker(new URL('../workers/chunkWorker.js', import.meta.url), { type: 'module' });
    this.genPool = new WorkerPool(factory, workerCount, 3);
    this.meshPool = new WorkerPool(factory, workerCount, 4);
    this.genPool.broadcast({ type: 'init', seed: meta.seed });
    this.storage = this.db ? new WorldStorage(this.db, meta.id) : null;
    if (this.storage) await this.storage.init();
    this.streamer = new ChunkStreamer(this.world, this.genPool, { storage: this.storage, renderDistance: s.get('renderDistance') });
    this.chunkRenderer = new ChunkRenderer(this.world, this.materials, this.meshPool, {
      renderDistance: s.get('renderDistance'),
      fancyLeaves: s.get('fancyLeaves'),
      shadows: s.get('shadows'),
      occlusionCulling: s.get('occlusionCulling'),
    });
    this.renderer.scene.add(this.chunkRenderer.group);

    // Time and weather (server authoritative, client mirrors).
    this.serverCycle = new DayNightCycle(meta.time ?? 1000);
    this.serverWeather = new Weather();
    if (meta.weather) this.serverWeather.fromJSON(meta.weather);
    this.cycle = new DayNightCycle(this.serverCycle.time);
    this.weather = new Weather();
    this.weather.cycle = false;
    this.weather.type = this.serverWeather.type;
    this.weather.rain = this.serverWeather.rain;
    this.weather.thunder = this.serverWeather.thunder;

    // Integrated server and client connected through a local transport.
    const spawn = meta.spawn ?? new TerrainGenerator(meta.seed).findSpawn();
    meta.spawn = spawn;
    this.server = new GameServer({ world: this.world, cycle: this.serverCycle, weather: this.serverWeather, spawn, rules: meta.rules ?? {} });
    const [clientSide, serverSide] = createLocalTransportPair();
    this.serverPlayer = this.server.accept(serverSide, { sharedWorld: true, saved: meta.player });
    this.client = new GameClient(clientSide, { world: this.world, sharedWorld: true });

    // Local player.
    this.player = new Player();
    this.player.gameMode = meta.player?.gameMode ?? meta.gameMode ?? 'survival';
    if (meta.player?.inventory) this.player.inventory.fromJSON(meta.player.inventory);
    else if (this.player.gameMode === 'creative') this.giveCreativeStarter();
    this.player.inventory.selected = meta.player?.selected ?? 0;
    this.player.flying = !!meta.player?.flying && this.player.gameMode === 'creative';
    this.isNewPlayer = !meta.player;
    const startPos = meta.player ?? spawn;
    this.player.teleport(startPos.x, startPos.y, startPos.z);
    this.player.yaw = meta.player?.yaw ?? 0;
    this.player.pitch = meta.player?.pitch ?? 0;

    this.controller = new PlayerController(this.player, this.input, this.world);
    this.cameraController = new CameraController(this.renderer.camera, this.player);
    this.interaction = new BlockInteraction({ player: this.player, input: this.input, world: this.world, client: this.client });
    this.pickup = new ItemPickup(this.player, this.client);
    this.pickup.onCollected = (stack) => this.emit('itemPicked', stack);

    // Visual systems.
    this.atmosphere = new Atmosphere();
    this.sky = new SkyRenderer();
    this.clouds = new CloudRenderer(meta.seed);
    this.clouds.setVisible(s.get('clouds'));
    this.weatherRenderer = new WeatherRenderer(this.world);
    this.particles = new ParticleSystem(this.blockTextures.texture, this.world);
    this.highlight = new BlockHighlight(this.blockTextures.texture);
    this.entityRenderer = new EntityRenderer(this.client, this.world, this.icons, this.blockTextures);
    this.heldItem = new HeldItemRenderer(this.icons, this.entityRenderer);
    this.renderer.scene.add(this.sky.group, this.clouds.mesh, this.weatherRenderer.mesh, this.particles.mesh, this.highlight.group, this.entityRenderer.group);

    // Audio.
    if (this.audio) {
      this.gameAudio = new GameAudio(this.audio, { controller: this.controller, interaction: this.interaction, client: this.client, player: this.player });
      this.ambient = new AmbientAudio(this.audio);
      this.music = new MusicSystem(this.audio);
    }

    this.wireEvents();
    s.on('change', this.settingsListener);
    this.loop.maxFps = s.get('maxFps');
    this.client.connect('Player', this.player.gameMode);

    this.loadingStart = performance.now();
    this.loop.start();
    await new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /** Fills the hotbar with useful blocks for a fresh creative world. @private */
  giveCreativeStarter() {
    const names = ['grass_block', 'dirt', 'stone', 'cobblestone', 'oak_planks', 'oak_log', 'glass', 'torch', 'bricks'];
    names.forEach((n, i) => {
      const item = itemRegistry.getByName(n);
      if (item) this.player.inventory.set(i, new ItemStack(item.id, 64));
    });
  }

  /** Subscribes to client/controller/interaction events. @private */
  wireEvents() {
    const c = this.client;
    c.on('welcome', (m) => {
      this.cycle.time = m.time;
      this.player.gameMode = m.gameMode;
      this.player.health = m.health;
      this.player.air = m.air;
    });
    c.on('time', (m) => {
      this.cycle.time = m.time;
      if (m.speed !== undefined) this.cycle.speed = m.speed;
    });
    c.on('weather', (m) => {
      this.weather.type = m.weather;
      if (m.lightning) {
        this.pendingLightning = true;
        if (this.gameAudio) this.gameAudio.thunder();
      }
    });
    c.on('health', (m) => {
      const hurt = m.health < this.player.health;
      this.player.health = m.health;
      this.player.maxHealth = m.maxHealth;
      this.player.air = m.air;
      this.player.maxAir = m.maxAir;
      if (hurt && m.cause) {
        this.player.hurtTime = 0.5;
        if (m.kbx || m.kby || m.kbz) this.controller.applyKnockback(m.kbx, m.kby, m.kbz);
      }
      this.emit('health', m);
    });
    c.on('died', (m) => {
      this.player.dead = true;
      this.player.health = 0;
      if (!this.server.rules.keepInventory && !this.player.creative) this.dropInventory();
      this.input.unlock();
      this.emit('died', m);
    });
    c.on('respawn', (m) => {
      this.player.dead = false;
      this.player.health = m.health;
      const pos = this.findStandingSpot(m.x, m.y, m.z);
      this.player.teleport(pos.x, pos.y, pos.z);
      this.serverPlayer.trustNextMove = true;
      this.emit('respawned');
    });
    c.on('correction', (m) => {
      this.player.teleport(m.x, m.y, m.z);
    });
    c.on('gameMode', (m) => {
      this.player.gameMode = m.gameMode;
      if (m.gameMode !== 'creative') this.player.flying = false;
      this.emit('gameMode', m.gameMode);
    });
    c.on('chat', (m) => this.emit('chat', m));
    c.on('blockRejected', () => {
      // The server refused a predicted edit; nothing else to undo locally in shared mode.
    });

    this.interaction.on('blockBreak', (b) => this.particles.blockBreak(b.x, b.y, b.z, b.id));
    this.interaction.on('dig', (hit) => this.particles.dig(hit));
    this.interaction.on('openContainer', (info) => this.emit('openContainer', info));
    this.controller.on('land', ({ distance, blockId }) => {
      if (distance > 2) {
        const p = this.player.position;
        this.particles.dust(p.x, p.y, p.z, blockId, Math.min(24, Math.floor(distance * 3)));
      }
    });
    this.controller.on('splash', (speed) => {
      const p = this.player.position;
      this.particles.splash(p.x, Math.floor(p.y) + 1, p.z, speed);
    });
  }

  /**
   * Drops every inventory stack at the player's position (death).
   * @private
   */
  dropInventory() {
    const inv = this.player.inventory;
    const p = this.player.position;
    for (let i = 0; i < inv.size; i++) {
      const s = inv.get(i);
      if (!s) continue;
      const a = Math.random() * Math.PI * 2;
      this.client.dropItem(s.toJSON(), { x: p.x, y: p.y + 1, z: p.z }, { x: Math.cos(a) * 2, y: 3, z: Math.sin(a) * 2 });
    }
    inv.clear();
  }

  /**
   * Finds a position above (x, y, z) where the player fits.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {{x:number,y:number,z:number}}
   */
  findStandingSpot(x, y, z) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    let by = Math.max(1, Math.floor(y));
    const free = (yy) => {
      const a = this.world.getBlock(bx, yy, bz);
      const b = this.world.getBlock(bx, yy + 1, bz);
      return !blockRegistry.solid[a] && !blockRegistry.solid[b];
    };
    // Drop onto the ground if spawning in the air, climb out if inside blocks.
    while (by > 1 && free(by) && free(by - 1) && !blockRegistry.solid[this.world.getBlock(bx, by - 1, bz)]) by--;
    while (by < 255 && !free(by)) by++;
    return { x: bx + 0.5, y: by, z: bz + 0.5 };
  }

  /** Loading progress 0..1 of the chunks around the player. @private */
  loadingProgress() {
    const p = this.player.position;
    const cx = Math.floor(p.x) >> 4;
    const cz = Math.floor(p.z) >> 4;
    let loaded = 0;
    let total = 0;
    const r = Math.min(3, this.settings.get('renderDistance'));
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        total++;
        if (this.world.getChunk(cx + dx, cz + dz)) loaded++;
      }
    }
    return loaded / total;
  }

  /** Completes loading once the spawn area exists. @private */
  checkReady() {
    const progress = this.loadingProgress();
    this.emit('progress', progress);
    const p = this.player.position;
    if (progress < 1 || !this.chunkRenderer.isMeshable(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4)) return;
    if (this.chunkRenderer.pendingCount > 40 && performance.now() - this.loadingStart < 20000) return;
    const spot = this.isNewPlayer ? this.findStandingSpot(p.x, this.world.getHeight(Math.floor(p.x), Math.floor(p.z)), p.z) : this.findStandingSpot(p.x, p.y, p.z);
    this.player.teleport(spot.x, spot.y, spot.z);
    this.serverPlayer.trustNextMove = true;
    this.sendState();
    this.ready = true;
    this.emit('ready');
    if (this.resolveReady) this.resolveReady();
  }

  /** Resumes simulation (pointer lock gained). */
  resume() {
    if (!this.ready || this.player.dead) return;
    this.paused = false;
    this.input.enabled = true;
    this.emit('resume');
  }

  /** Pauses simulation (menus). */
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.input.releaseAll();
    this.emit('pause');
  }

  /**
   * Enables/disables gameplay input while overlays (inventory, chat) are open
   * without pausing the world.
   * @param {boolean} enabled
   */
  setInputEnabled(enabled) {
    this.input.enabled = enabled;
    if (!enabled) this.input.releaseAll();
  }

  /** @private */
  sendState() {
    const p = this.player;
    const b = p.body;
    this.client.sendPlayerState({
      x: b.position.x, y: b.position.y, z: b.position.z,
      vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z,
      yaw: p.yaw, pitch: p.pitch,
      onGround: b.onGround, sneaking: p.sneaking, sprinting: p.sprinting, flying: p.flying,
      inWater: b.submersion > 0.1, eyeInWater: p.eyeInWater,
    });
  }

  /**
   * One rendered frame.
   * @private
   * @param {number} dt
   */
  frame(dt) {
    if (this.disposed) return;
    this.time += dt;
    this.frameCount = (this.frameCount ?? 0) + 1;
    const s = this.settings;
    const p = this.player;
    const simulate = !this.paused || !this.ready;

    if (!this.ready) this.checkReady();

    const prof = this.profiler;
    prof.begin('physics');
    if (this.ready && !this.paused) {
      if (this.input.locked) this.controller.updateLook(s.get('mouseSensitivity'), s.get('invertY'));
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 8) {
        this.controller.fixedUpdate(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === 8) this.accumulator = 0;
      this.stateTimer += dt;
      if (this.stateTimer >= 1 / CLIENT_STATE_RATE) {
        this.stateTimer = 0;
        this.sendState();
      }
    }

    prof.end();
    if (simulate) {
      prof.begin('server');
      this.server.update(dt);
      prof.end();
      prof.begin('network');
      this.client.pump();
      prof.end();
      this.cycle.update(dt);
      this.weather.update(dt);
      if (this.pendingLightning) {
        this.weather.lightningStruck = true;
        this.pendingLightning = false;
      }
    }

    const alpha = this.ready && !this.paused ? this.accumulator / FIXED_DT : 1;
    this.cameraController.update(dt, alpha, { fov: s.get('fov'), bobbing: s.get('viewBobbing') });
    const cam = this.renderer.camera;
    cam.getWorldDirection(this.lookDir);
    this.eye.copy(cam.position);

    prof.begin('interaction');
    if (this.ready && !this.paused) {
      this.interaction.update(dt, this.eye, this.lookDir);
      this.pickup.update(dt);
    }
    prof.end();

    // Streaming and meshing continue while paused so the world fills in.
    prof.begin('streaming');
    this.streamer.update(p.position.x, p.position.z);
    prof.end();
    prof.begin('meshing');
    this.chunkRenderer.update(cam);
    prof.end();
    prof.begin('effects');

    const underwater = p.eyeInWater;
    this.atmosphere.update(dt, this.cycle, this.weather, { renderDistance: s.get('renderDistance'), underwater, viewDir: this.lookDir });
    this.atmosphere.apply(this.renderer, this.materials);
    this.materials.shared.uTime.value = this.time;
    this.materials.shared.uWind.value = 1 + this.weather.rain * 1.5;
    this.sky.update(cam, this.atmosphere.state, this.time);
    this.clouds.update(dt, cam, this.atmosphere.state, this.weather.rain);
    this.weatherRenderer.update(dt, cam.position, this.weather.rain, this.cycle.daylight, this.time);
    this.particles.update(dt, this.cycle.skyLightFactor);
    prof.end();
    prof.begin('entities');
    this.entityRenderer.update(dt);
    prof.end();
    this.highlight.update(this.ready && !this.paused ? this.interaction.target : null, this.interaction.crackStage);
    this.sunFocus.set(p.position.x, p.position.y, p.position.z);
    this.renderer.updateSun(this.sunFocus, this.atmosphere.state.lightDir);

    const feet = p.position;
    const light = this.world.getLight(Math.floor(feet.x), Math.floor(feet.y + 1), Math.floor(feet.z));
    const brightness = Math.max((light >> 4) * this.cycle.skyLightFactor, light & 15) / 15;
    const held = p.inventory.held;
    this.heldItem.update(dt, {
      itemId: held ? held.id : 0,
      swing: p.swingTime,
      bob: this.cameraController.bobState(),
      brightness,
      eating: this.interaction.eatTimer > 0,
      aspect: this.renderer.camera.aspect,
    });

    prof.begin('audio');
    if (this.audio) {
      this.audio.setListener(cam, this.lookDir);
      this.audio.setUnderwater(underwater);
      this.gameAudio.update(dt);
      this.ambient.update(dt, {
        world: this.world,
        position: cam.position,
        rainExposure: this.weatherRenderer.exposure,
        rainFraction: this.weatherRenderer.rainFraction,
        thunder: this.weather.thunder,
        underwater,
      });
      this.music.update(dt);
    }
    prof.end();

    prof.begin('render');
    this.renderer.render();
    if (this.ready && !p.dead && !this.hideHand) this.heldItem.render(this.renderer.webgl);
    prof.end();

    if (this.ready && this.storage) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= s.get('autosaveInterval')) {
        this.autosaveTimer = 0;
        this.save().catch((e) => console.error('Autosave failed', e));
      }
    }
    this.input.endFrame();
  }

  /** @private */
  applySetting(key, value) {
    switch (key) {
      case 'renderDistance':
        this.streamer.setRenderDistance(value);
        this.chunkRenderer.setRenderDistance(value);
        break;
      case 'shadows':
        this.renderer.setShadowsEnabled(value);
        this.chunkRenderer.setShadows(value);
        break;
      case 'shadowQuality':
        this.renderer.setShadowMapSize(SHADOW_SIZES[value]);
        break;
      case 'clouds':
        this.clouds.setVisible(value);
        break;
      case 'fancyLeaves':
        this.chunkRenderer.setFancyLeaves(value);
        break;
      case 'occlusionCulling':
        this.chunkRenderer.setOcclusionCulling(value);
        break;
      case 'renderScale':
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * value);
        break;
      case 'maxFps':
        this.loop.maxFps = value;
        break;
      default:
        break;
    }
  }

  /**
   * Sends a chat line or command to the server.
   * @param {string} text
   */
  sendChat(text) {
    this.client.chat(text);
  }

  /** Requests a respawn after death. */
  respawn() {
    this.client.respawn();
  }

  /**
   * Switches game mode (single-player cheat).
   * @param {'survival'|'creative'} mode
   */
  setGameMode(mode) {
    this.client.setGameMode(mode);
  }

  /**
   * Snapshot used for the debug overlay.
   * @returns {object}
   */
  debugInfo() {
    const p = this.player;
    const pos = p.position;
    const bx = Math.floor(pos.x);
    const by = Math.floor(pos.y);
    const bz = Math.floor(pos.z);
    const chunk = this.world.getChunk(bx >> 4, bz >> 4);
    const biome = chunk ? BIOMES[chunk.biomes[(bx & 15) | ((bz & 15) << 4)]] : null;
    const light = this.world.getLight(bx, by, bz);
    const yawDeg = ((((-p.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const facing = ['north', 'east', 'south', 'west'][Math.round(yawDeg / 90) % 4];
    const info = this.renderer.webgl.info;
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    const chunkMem = Math.round((this.world.chunks.size * (65536 * 2)) / 1048576);
    const t = this.interaction.target;
    return {
      fps: this.loop.fps,
      frameTime: this.loop.frameTime,
      x: pos.x, y: pos.y, z: pos.z,
      block: [bx, by, bz],
      chunk: [bx >> 4, by >> 4, bz >> 4],
      facing,
      biome: biome ? biome.displayName : '—',
      skyLight: light >> 4,
      blockLight: light & 15,
      seed: this.meta.seedText ?? this.meta.seed,
      renderDistance: this.settings.get('renderDistance'),
      chunks: this.world.chunks.size,
      pendingChunks: this.streamer.pendingCount,
      sections: this.chunkRenderer.stats.sections,
      meshes: this.chunkRenderer.stats.meshes,
      visibleMeshes: this.chunkRenderer.stats.visible,
      pendingMeshes: this.chunkRenderer.pendingCount,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      entities: this.client.entities.size,
      time: this.cycle.formatClock(),
      day: this.cycle.day,
      weather: this.weather.type,
      memory: mem,
      chunkMemory: chunkMem,
      gameMode: p.gameMode,
      profile: this.profiler.top(6),
      target: t ? `${blockRegistry.get(t.id).displayName} @ ${t.x} ${t.y} ${t.z}` : null,
    };
  }

  /**
   * Persists the world (metadata, player, modified chunks).
   * @returns {Promise<void>}
   */
  async save() {
    if (!this.storage) return;
    const p = this.player;
    const sp = this.server.savePlayer(this.serverPlayer);
    const playerData = {
      ...sp,
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      yaw: p.yaw,
      pitch: p.pitch,
      gameMode: p.gameMode,
      inventory: p.inventory.toJSON(),
      selected: p.inventory.selected,
      flying: p.flying,
    };
    this.server.storeAllEntities();
    await this.streamer.saveAll();
    for (const chunk of this.world.chunks.values()) chunk.entityData = null;
    await this.storage.saveMeta({
      name: this.meta.name,
      seed: this.meta.seed,
      seedText: this.meta.seedText,
      gameMode: this.meta.gameMode,
      spawn: this.meta.spawn,
      time: this.serverCycle.time,
      weather: this.serverWeather.toJSON(),
      rules: this.server.rules,
      player: playerData,
    });
    await this.storage.flush();
    this.emit('saved');
  }

  /** Stops the session and frees every resource. */
  dispose() {
    this.disposed = true;
    this.loop.stop();
    this.settings.off('change', this.settingsListener);
    if (this.ambient) this.ambient.dispose();
    if (this.gameAudio) this.gameAudio.dispose();
    if (this.music) this.music.stop();
    this.pickup.dispose();
    this.server.dispose();
    this.streamer.dispose();
    this.chunkRenderer.dispose();
    this.genPool.dispose();
    this.meshPool.dispose();
    this.entityRenderer.dispose();
    this.heldItem.dispose();
    this.particles.dispose();
    this.highlight.dispose();
    this.sky.dispose();
    this.clouds.dispose();
    this.weatherRenderer.dispose();
    this.materials.dispose();
    this.blockTextures.releaseGpu();
    this.renderer.dispose();
    if (this.ownsInput) this.input.dispose();
    this.removeAllListeners();
  }
}
