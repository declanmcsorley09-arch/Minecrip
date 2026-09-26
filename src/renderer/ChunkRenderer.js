import * as THREE from 'three';
import { chunkKey, chunkKeyX, chunkKeyZ, sectionKey } from '../utils/coords.js';
import { ObjectPool } from '../utils/ObjectPool.js';
import { SECTIONS_PER_CHUNK } from '../world/constants.js';
import { fillSectionInput, createSectionBuffers } from './SectionInput.js';
import { OcclusionCuller } from './OcclusionCuller.js';
import { VISIBILITY_ALL } from './ChunkMesher.js';
import { RenderLayer } from '../blocks/BlockShapes.js';

const SECTION_SPHERE = new THREE.Sphere(new THREE.Vector3(8, 8, 8), Math.sqrt(3 * 64) + 0.5);
const SECTION_BOX = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(16, 16, 16));

/**
 * @typedef {object} SectionState
 * @property {number} key
 * @property {number} cx
 * @property {number} sy
 * @property {number} cz
 * @property {(THREE.Mesh|null)[]} meshes one per render layer
 * @property {number} visibility face connectivity mask
 * @property {number} version incremented whenever the section needs rebuilding
 * @property {boolean} building a worker job is in flight
 */

/**
 * Owns the Three.js meshes of every render section.
 *
 * Responsibilities: deciding when chunks become meshable (all 8 neighbours
 * loaded), scheduling mesh jobs nearest-first with player edits prioritised,
 * caching meshes until their section is dirtied, converting worker output to
 * BufferGeometry, pooling Mesh objects, and applying occlusion + distance
 * culling.
 */
export class ChunkRenderer {
  /**
   * @param {import('../world/World.js').World} world
   * @param {import('./ChunkMaterials.js').ChunkMaterials} materials
   * @param {import('../workers/WorkerPool.js').WorkerPool} pool meshing workers
   * @param {object} [options]
   * @param {number} [options.renderDistance=8]
   * @param {boolean} [options.fancyLeaves=true]
   * @param {boolean} [options.shadows=true]
   * @param {boolean} [options.occlusionCulling=true]
   */
  constructor(world, materials, pool, options = {}) {
    this.world = world;
    this.materials = materials;
    this.pool = pool;
    this.renderDistance = options.renderDistance ?? 8;
    this.fancyLeaves = options.fancyLeaves ?? true;
    this.shadows = options.shadows ?? true;
    this.occlusionCulling = options.occlusionCulling ?? true;
    this.group = new THREE.Group();
    this.group.name = 'chunks';
    this.group.matrixAutoUpdate = false;
    /** @type {Map<number, SectionState>} */
    this.sections = new Map();
    this.meshedChunks = new Set();
    this.buildQueue = new Set();
    this.urgent = new Set();
    this.ordered = [];
    this.orderDirty = true;
    this.inputs = new ObjectPool(createSectionBuffers, null, 32);
    this.meshPool = [];
    this.culler = new OcclusionCuller();
    this.cullDirty = true;
    this.cameraSection = [NaN, NaN, NaN];
    this.cameraChunk = [NaN, NaN];
    this.stats = { sections: 0, meshes: 0, visible: 0, queued: 0, building: 0 };

    this.onChunkAdded = (chunk) => this.handleChunkAdded(chunk);
    this.onChunkRemoved = (chunk) => this.handleChunkRemoved(chunk);
    this.onBlockChanged = (e) => {
      if (e.cause === 'player') this.markUrgentAround(e.x, e.y, e.z);
    };
    world.on('chunkAdded', this.onChunkAdded);
    world.on('chunkRemoved', this.onChunkRemoved);
    world.on('blockChanged', this.onBlockChanged);
  }

  /**
   * Whether a chunk and all eight neighbours are loaded.
   * @param {number} cx
   * @param {number} cz
   * @returns {boolean}
   */
  isMeshable(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) if (!this.world.getChunk(cx + dx, cz + dz)) return false;
    }
    return true;
  }

  /** @private */
  inRange(cx, cz) {
    const dx = cx - this.cameraChunk[0];
    const dz = cz - this.cameraChunk[1];
    if (Number.isNaN(dx)) return true;
    const r = this.renderDistance;
    return dx * dx + dz * dz <= r * r + r;
  }

  /** @private */
  handleChunkAdded(chunk) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) this.tryQueueChunk(chunk.cx + dx, chunk.cz + dz);
    }
  }

  /** @private */
  tryQueueChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this.meshedChunks.has(key)) return;
    const chunk = this.world.getChunk(cx, cz);
    if (!chunk || !this.inRange(cx, cz) || !this.isMeshable(cx, cz)) return;
    this.meshedChunks.add(key);
    for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
      if (chunk.isSectionEmpty(sy)) continue;
      this.queueSection(cx, sy, cz);
    }
  }

  /** @private */
  getSection(cx, sy, cz, create) {
    const key = sectionKey(cx, sy, cz);
    let s = this.sections.get(key);
    if (!s && create) {
      s = { key, cx, sy, cz, meshes: [null, null, null], visibility: VISIBILITY_ALL, version: 0, building: false };
      this.sections.set(key, s);
    }
    return s;
  }

  /** @private */
  queueSection(cx, sy, cz) {
    const s = this.getSection(cx, sy, cz, true);
    s.version++;
    if (!this.buildQueue.has(s.key)) {
      this.buildQueue.add(s.key);
      this.orderDirty = true;
    }
  }

  /** @private */
  markUrgentAround(x, y, z) {
    const sy = y >> 4;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const s = sy + dy;
          if (s < 0 || s >= SECTIONS_PER_CHUNK) continue;
          this.urgent.add(sectionKey(((x + dx) >> 4), s, ((z + dz) >> 4)));
        }
      }
    }
  }

  /** @private */
  handleChunkRemoved(chunk) {
    this.meshedChunks.delete(chunkKey(chunk.cx, chunk.cz));
    for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
      const key = sectionKey(chunk.cx, sy, chunk.cz);
      const s = this.sections.get(key);
      if (!s) continue;
      for (let i = 0; i < 3; i++) this.setLayerMesh(s, i, null);
      this.sections.delete(key);
      this.buildQueue.delete(key);
      this.urgent.delete(key);
    }
    this.cullDirty = true;
  }

  /**
   * Per-frame update: consumes dirty sections, dispatches mesh jobs and
   * refreshes visibility.
   * @param {THREE.Camera} camera
   */
  update(camera) {
    const p = camera.position;
    const ccx = Math.floor(p.x) >> 4;
    const ccz = Math.floor(p.z) >> 4;
    const csy = Math.max(0, Math.min(SECTIONS_PER_CHUNK - 1, Math.floor(p.y) >> 4));
    if (ccx !== this.cameraChunk[0] || ccz !== this.cameraChunk[1]) {
      this.cameraChunk[0] = ccx;
      this.cameraChunk[1] = ccz;
      this.orderDirty = true;
      this.cullDirty = true;
      for (const chunk of this.world.chunks.values()) this.tryQueueChunk(chunk.cx, chunk.cz);
    }
    if (csy !== this.cameraSection[1] || ccx !== this.cameraSection[0] || ccz !== this.cameraSection[2]) {
      this.cameraSection[0] = ccx;
      this.cameraSection[1] = csy;
      this.cameraSection[2] = ccz;
      this.cullDirty = true;
    }

    this.consumeDirty();
    this.dispatch();
    if (this.cullDirty) {
      this.cullDirty = false;
      this.applyVisibility(p.y);
    }
    this.stats.sections = this.sections.size;
    this.stats.queued = this.buildQueue.size;
  }

  /** @private */
  consumeDirty() {
    const dirty = this.world.dirtySections;
    if (dirty.size === 0) return;
    for (const key of dirty) {
      const sy = key % 16;
      const ck = (key - sy) / 16;
      if (!this.meshedChunks.has(ck)) continue;
      let s = this.sections.get(key);
      if (!s) {
        const chunk = this.chunkFromKey(ck);
        if (!chunk || chunk.isSectionEmpty(sy)) continue;
        s = this.getSection(chunk.cx, sy, chunk.cz, true);
      }
      s.version++;
      if (!this.buildQueue.has(key)) {
        this.buildQueue.add(key);
        this.orderDirty = true;
      }
    }
    dirty.clear();
  }

  /** @private */
  chunkFromKey(ck) {
    return this.world.getChunk(chunkKeyX(ck), chunkKeyZ(ck));
  }

  /** @private */
  dispatch() {
    if (this.buildQueue.size === 0 || !this.pool.hasCapacity()) return;
    // Urgent (player-edited) sections first, regardless of order.
    if (this.urgent.size > 0) {
      for (const key of this.urgent) {
        if (!this.pool.hasCapacity()) break;
        const s = this.sections.get(key);
        if (s && this.buildQueue.has(key) && !s.building) this.submit(s);
      }
      this.urgent.clear();
    }
    if (this.orderDirty) {
      const [cx, cz] = this.cameraChunk;
      const csy = this.cameraSection[1];
      this.ordered = [...this.buildQueue].map((k) => this.sections.get(k)).filter(Boolean);
      this.ordered.sort((a, b) => {
        const da = (a.cx - cx) ** 2 + (a.cz - cz) ** 2 + ((a.sy - csy) ** 2) * 0.25;
        const db = (b.cx - cx) ** 2 + (b.cz - cz) ** 2 + ((b.sy - csy) ** 2) * 0.25;
        return da - db;
      });
      this.orderDirty = false;
    }
    let i = 0;
    for (; i < this.ordered.length && this.pool.hasCapacity(); i++) {
      const s = this.ordered[i];
      if (!this.buildQueue.has(s.key) || s.building || !this.sections.has(s.key)) continue;
      this.submit(s);
    }
    this.ordered.splice(0, i);
  }

  /** @private */
  submit(s) {
    this.buildQueue.delete(s.key);
    const chunk = this.world.getChunk(s.cx, s.cz);
    if (!chunk) return;
    const input = this.inputs.acquire();
    if (!fillSectionInput(this.world, s.cx, s.sy, s.cz, input.blocks, input.light)) {
      this.inputs.release(input);
      return;
    }
    const climate = chunk.climate.slice();
    s.building = true;
    this.stats.building++;
    this.pool.submit(
      {
        type: 'mesh',
        key: s.key,
        version: s.version,
        blocks: input.blocks,
        light: input.light,
        climate,
        ox: s.cx * 16,
        oy: s.sy * 16,
        oz: s.cz * 16,
        options: { fancyLeaves: this.fancyLeaves },
      },
      [input.blocks.buffer, input.light.buffer, climate.buffer],
      (data) => this.onMeshed(data),
    );
  }

  /** @private */
  onMeshed(data) {
    this.stats.building--;
    this.inputs.release({ blocks: data.blocks, light: data.light });
    const s = this.sections.get(data.key);
    if (!s) return;
    s.building = false;
    this.setLayerMesh(s, RenderLayer.OPAQUE, data.opaque);
    this.setLayerMesh(s, RenderLayer.CUTOUT, data.cutout);
    this.setLayerMesh(s, RenderLayer.TRANSLUCENT, data.translucent);
    if (s.visibility !== data.visibility) {
      s.visibility = data.visibility;
      this.cullDirty = true;
    }
    if (data.version !== s.version) {
      this.buildQueue.add(s.key);
      this.urgent.add(s.key);
    }
    const visible = this.isSectionVisible(s);
    for (const m of s.meshes) if (m) m.visible = visible;
  }

  /** @private */
  isSectionVisible(s) {
    if (!this.inRange(s.cx, s.cz)) return false;
    if (!this.occlusionCulling || this.lastVisible === undefined) return true;
    return this.lastVisible.has(s.key);
  }

  /**
   * Replaces (or removes) the mesh of one render layer of a section.
   * @private
   */
  setLayerMesh(s, layer, data) {
    let mesh = s.meshes[layer];
    if (!data) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.meshPool.push(mesh);
        s.meshes[layer] = null;
        this.stats.meshes--;
      }
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3, true));
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geo.setAttribute('layer', new THREE.BufferAttribute(data.layers, 1));
    geo.setAttribute('light', new THREE.BufferAttribute(data.lights, 4));
    geo.setAttribute('tint', new THREE.BufferAttribute(data.tints, 3, true));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.boundingSphere = SECTION_SPHERE;
    geo.boundingBox = SECTION_BOX;
    if (!mesh) {
      mesh = this.meshPool.pop() ?? new THREE.Mesh();
      mesh.matrixAutoUpdate = false;
      mesh.material = this.materials.forLayer(layer);
      mesh.position.set(s.cx * 16, s.sy * 16, s.cz * 16);
      mesh.updateMatrix();
      mesh.matrixWorld.copy(mesh.matrix);
      mesh.castShadow = layer !== RenderLayer.TRANSLUCENT && this.shadows;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = layer === RenderLayer.CUTOUT ? this.materials.cutoutDepth : undefined;
      mesh.renderOrder = layer;
      s.meshes[layer] = mesh;
      this.group.add(mesh);
      this.stats.meshes++;
    } else {
      mesh.geometry.dispose();
    }
    mesh.geometry = geo;
  }

  /**
   * Recomputes which sections are visible (occlusion + distance).
   * @private
   * @param {number} cameraY
   */
  applyVisibility(cameraY) {
    const [cx, csy, cz] = this.cameraSection;
    const outside = cameraY < 0 || cameraY >= 256;
    if (this.occlusionCulling && !outside) {
      this.lastVisible = this.culler.compute(cx, csy, cz, this.renderDistance, (x, y, z) => {
        if (!this.world.getChunk(x, z)) return -1;
        const s = this.sections.get(sectionKey(x, y, z));
        return s ? s.visibility : VISIBILITY_ALL;
      });
    } else {
      this.lastVisible = undefined;
    }
    let visibleCount = 0;
    for (const s of this.sections.values()) {
      const visible = this.isSectionVisible(s);
      for (const m of s.meshes) {
        if (!m) continue;
        m.visible = visible;
        if (visible) visibleCount++;
      }
    }
    this.stats.visible = visibleCount;
  }

  /**
   * Changes the render distance (queues newly in-range chunks).
   * @param {number} r
   */
  setRenderDistance(r) {
    this.renderDistance = r;
    this.cameraChunk[0] = NaN;
    this.cullDirty = true;
  }

  /**
   * Enables/disables fancy leaves and rebuilds every section.
   * @param {boolean} fancy
   */
  setFancyLeaves(fancy) {
    if (this.fancyLeaves === fancy) return;
    this.fancyLeaves = fancy;
    this.rebuildAll();
  }

  /**
   * Toggles shadow casting on all meshes.
   * @param {boolean} enabled
   */
  setShadows(enabled) {
    this.shadows = enabled;
    for (const s of this.sections.values()) {
      for (let i = 0; i < 3; i++) if (s.meshes[i]) s.meshes[i].castShadow = enabled && i !== RenderLayer.TRANSLUCENT;
    }
  }

  /**
   * Toggles occlusion culling.
   * @param {boolean} enabled
   */
  setOcclusionCulling(enabled) {
    this.occlusionCulling = enabled;
    this.cullDirty = true;
  }

  /** Queues every loaded section for rebuilding. */
  rebuildAll() {
    for (const s of this.sections.values()) {
      s.version++;
      this.buildQueue.add(s.key);
    }
    this.orderDirty = true;
  }

  /**
   * Number of sections still waiting for a mesh.
   * @returns {number}
   */
  get pendingCount() {
    return this.buildQueue.size + this.stats.building;
  }

  /** Disposes every mesh and stops listening to the world. */
  dispose() {
    this.world.off('chunkAdded', this.onChunkAdded);
    this.world.off('chunkRemoved', this.onChunkRemoved);
    this.world.off('blockChanged', this.onBlockChanged);
    for (const s of this.sections.values()) {
      for (let i = 0; i < 3; i++) this.setLayerMesh(s, i, null);
    }
    this.sections.clear();
    this.meshPool.length = 0;
  }
}
