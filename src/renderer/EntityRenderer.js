import * as THREE from 'three';
import { createMobModel, hasMobModel, disposeMobTemplates } from './models/MobModels.js';
import { blockRegistry } from '../blocks/index.js';
import { Shape } from '../blocks/BlockShapes.js';
import { itemRegistry } from '../items/index.js';
import { EntityFlags } from '../networking/Protocol.js';
import { toCanvas } from './ItemIcons.js';
import { damp } from '../utils/math.js';
import { createEntityMaterial, setEntityLight } from './EntityMaterial.js';

/**
 * Renders interpolated server entities: animated mobs, dropped items
 * (spinning mini blocks or flat sprites), falling blocks and arrows. Each
 * entity is shaded by the voxel light at its position so mobs darken in
 * caves and at night.
 */
export class EntityRenderer {
  /**
   * @param {import('../networking/GameClient.js').GameClient} client
   * @param {import('../world/World.js').World} world
   * @param {import('./ItemIcons.js').ItemIcons} icons
   * @param {import('./textures/BlockTextureArray.js').BlockTextureArray} blockTextures
   */
  constructor(client, world, icons, blockTextures) {
    this.client = client;
    this.world = world;
    this.icons = icons;
    this.blockTextures = blockTextures;
    this.group = new THREE.Group();
    this.group.name = 'entities';
    /** @type {Map<number, object>} */
    this.views = new Map();
    this.cubeTextures = new Map();
    this.spriteTextures = new Map();
    this.cubeGeometry = this.createCubeGeometry();
    this.spriteGeometry = new THREE.PlaneGeometry(1, 1);
    this.arrowGeometry = new THREE.BoxGeometry(0.06, 0.06, 0.6);
    this.time = 0;
    this.onRemoved = (e) => this.removeView(e.id);
    client.on('entityRemoved', this.onRemoved);
  }

  /** Cube with UVs into a 3×2 face atlas (+X, -X, +Y, -Y, +Z, -Z). @private */
  createCubeGeometry() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const uv = geo.getAttribute('uv');
    for (let f = 0; f < 6; f++) {
      const col = f % 3;
      const row = Math.floor(f / 3);
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, (col + uv.getX(i)) / 3, 1 - (row + 1 - uv.getY(i)) / 2);
      }
    }
    return geo;
  }

  /**
   * Face atlas texture for a block (shared with the held item renderer).
   * @param {number} blockId
   * @returns {THREE.CanvasTexture}
   */
  cubeTexture(blockId) {
    let tex = this.cubeTextures.get(blockId);
    if (tex) return tex;
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    for (let f = 0; f < 6; f++) {
      const img = this.icons.tintedTexture(blockRegistry.textureOf(blockId, f), blockRegistry.tint[blockId]);
      ctx.drawImage(toCanvas(img), (f % 3) * 16, Math.floor(f / 3) * 16);
    }
    tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cubeTextures.set(blockId, tex);
    return tex;
  }

  /**
   * Flat sprite texture for an item.
   * @param {number} itemId
   * @returns {THREE.CanvasTexture}
   */
  spriteTexture(itemId) {
    let tex = this.spriteTextures.get(itemId);
    if (tex) return tex;
    const img = this.icons.image(itemId);
    tex = new THREE.CanvasTexture(img ? toCanvas(img) : document.createElement('canvas'));
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.spriteTextures.set(itemId, tex);
    return tex;
  }

  /** @private */
  createView(e) {
    if (hasMobModel(e.type)) {
      const model = createMobModel(e.type);
      this.group.add(model.root);
      return { kind: 'mob', model, root: model.root, material: model.material, walk: 0, deathTime: -1, attack: 0 };
    }
    if (e.type === 'item' || e.type === 'falling_block') {
      const itemId = e.type === 'item' ? e.data.id : itemRegistry.itemForBlock(e.data.b);
      const blockId = e.type === 'item' ? itemRegistry.get(e.data.id)?.blockId ?? 0 : e.data.b;
      const flat = !blockId || blockRegistry.shape[blockId] === Shape.CROSS || blockRegistry.shape[blockId] === Shape.TORCH;
      let mesh;
      if (flat) {
        const material = createEntityMaterial({ map: this.spriteTexture(itemId), alphaTest: 0.5, side: THREE.DoubleSide });
        mesh = new THREE.Mesh(this.spriteGeometry, material);
        mesh.scale.setScalar(0.42);
      } else {
        const material = createEntityMaterial({ map: this.cubeTexture(blockId), alphaTest: 0.1 });
        mesh = new THREE.Mesh(this.cubeGeometry, material);
        mesh.scale.setScalar(e.type === 'falling_block' ? 0.98 : 0.26);
      }
      mesh.castShadow = true;
      const root = new THREE.Group();
      root.add(mesh);
      this.group.add(root);
      return { kind: e.type, root, mesh, material: mesh.material, flat, phase: Math.random() * 10, count: e.data.c ?? 1, itemId };
    }
    if (e.type === 'arrow') {
      const root = new THREE.Group();
      const shaft = new THREE.Mesh(this.arrowGeometry, createEntityMaterial({ color: 0x7a5a3a }));
      shaft.castShadow = true;
      root.add(shaft);
      root.rotation.order = 'YXZ';
      this.group.add(root);
      return { kind: 'arrow', root, material: shaft.material };
    }
    return null;
  }

  /** @private */
  removeView(id) {
    const v = this.views.get(id);
    if (!v) return;
    this.group.remove(v.root);
    if (v.material) v.material.dispose();
    this.views.delete(id);
  }

  /**
   * Syncs views with remote entities and animates them.
   * @param {number} dt
   */
  update(dt) {
    this.time += dt;
    for (const e of this.client.entities.values()) {
      let v = this.views.get(e.id);
      if (!v) {
        v = this.createView(e);
        if (!v) continue;
        this.views.set(e.id, v);
      }
      setEntityLight(v.material, this.world.getLight(Math.floor(e.x), Math.floor(e.y + 0.5), Math.floor(e.z)));
      if (v.kind === 'mob') this.animateMob(v, e, dt);
      else if (v.kind === 'item' || v.kind === 'falling_block') this.animateItem(v, e);
      else if (v.kind === 'arrow') {
        v.root.position.set(e.x, e.y, e.z);
        v.root.rotation.set(e.pitch, e.yaw, 0);
      }
    }
  }

  /** @private */
  animateMob(v, e, dt) {
    const root = v.root;
    const material = v.material;
    const parts = v.model.parts;
    root.position.set(e.x, e.y, e.z);
    root.rotation.y = e.yaw;
    const speed = Math.min(e.speed, 6);
    v.walk += speed * dt * 3.2;
    const swing = Math.sin(v.walk) * Math.min(1, speed / 2.5) * 0.8;
    const set = (name, x) => {
      if (parts[name]) parts[name].rotation.x = x;
    };
    set('legFR', swing);
    set('legBL', swing);
    set('legFL', -swing);
    set('legBR', -swing);
    set('legR', swing);
    set('legL', -swing);
    const attacking = (e.flags & EntityFlags.ATTACKING) !== 0;
    v.attack += ((attacking ? 1 : 0) - v.attack) * damp(12, dt);
    if (e.type === 'zombie') {
      set('armR', -Math.PI / 2 + Math.sin(this.time * 2) * 0.05 - v.attack * 0.5);
      set('armL', -Math.PI / 2 - Math.sin(this.time * 2) * 0.05 - v.attack * 0.5);
    } else if (e.type === 'skeleton') {
      set('armR', -Math.PI / 2 * (0.4 + v.attack * 0.6) - swing * 0.3);
      set('armL', swing * 0.8);
    }
    if (parts.head) {
      const headYaw = e.data.hy != null ? e.data.hy - e.yaw : 0;
      parts.head.rotation.y = Math.atan2(Math.sin(headYaw), Math.cos(headYaw));
      parts.head.rotation.x = -e.pitch;
    }
    // Death: fall over sideways.
    if (e.flags & EntityFlags.DEAD) {
      if (v.deathTime < 0) v.deathTime = 0;
      v.deathTime += dt;
      root.rotation.z = Math.min(1, v.deathTime / 0.6) * (Math.PI / 2);
    }
    const hurt = (e.flags & (EntityFlags.HURT | EntityFlags.DEAD)) !== 0;
    const burning = (e.flags & EntityFlags.BURNING) !== 0;
    material.color.setRGB(1, hurt ? 0.45 : 1, hurt ? 0.45 : 1);
    if (burning) material.emissive.setRGB(0.55 + Math.sin(this.time * 25) * 0.15, 0.22, 0.02);
    else material.emissive.setRGB(hurt ? 0.25 : 0, 0, 0);
  }

  /** @private */
  animateItem(v, e) {
    v.root.position.set(e.x, e.y, e.z);
    if (v.kind === 'item') {
      const bob = Math.sin(this.time * 2.5 + v.phase) * 0.06 + 0.2;
      v.mesh.position.y = bob;
      v.mesh.rotation.y = this.time * 1.4 + v.phase;
    } else {
      v.mesh.position.y = 0.49;
    }
  }

  /** Removes every view and releases GPU resources. */
  dispose() {
    this.client.off('entityRemoved', this.onRemoved);
    for (const id of [...this.views.keys()]) this.removeView(id);
    for (const t of this.cubeTextures.values()) t.dispose();
    for (const t of this.spriteTextures.values()) t.dispose();
    this.cubeGeometry.dispose();
    this.spriteGeometry.dispose();
    this.arrowGeometry.dispose();
    disposeMobTemplates();
  }
}
