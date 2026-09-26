import * as THREE from 'three';
import { blockRegistry } from '../blocks/index.js';
import { Shape } from '../blocks/BlockShapes.js';
import { itemRegistry } from '../items/index.js';
import { toCanvas } from './ItemIcons.js';
import { damp } from '../utils/math.js';

/**
 * First-person view of the held item (or the bare arm), rendered in a
 * separate overlay pass so it never clips into walls. Flat items are
 * extruded into 3D pixel meshes; blocks are shown as small cubes.
 * Animates swinging, equipping, eating and walking.
 */
export class HeldItemRenderer {
  /**
   * @param {import('./ItemIcons.js').ItemIcons} icons
   * @param {import('./EntityRenderer.js').EntityRenderer} entityRenderer shared cube textures
   */
  constructor(icons, entityRenderer) {
    this.icons = icons;
    this.entityRenderer = entityRenderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.light = new THREE.DirectionalLight(0xffffff, 2.2);
    this.light.position.set(-0.3, 1, 0.6);
    this.ambient = new THREE.AmbientLight(0xffffff, 1.3);
    this.scene.add(this.light, this.ambient);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.currentId = -1;
    this.mesh = null;
    this.material = null;
    this.equip = 1;
    this.geometryCache = new Map();
    this.armGeometry = new THREE.BoxGeometry(0.22, 0.22, 0.75);
    this.armMaterial = new THREE.MeshLambertMaterial({ color: 0xc69c7a });
  }

  /**
   * Builds an extruded pixel-art geometry from a 16×16 image.
   * @private
   */
  extruded(itemId) {
    let geo = this.geometryCache.get(itemId);
    if (geo) return geo;
    const img = this.icons.image(itemId);
    const positions = [];
    const normals = [];
    const uvs = [];
    const S = 16;
    const depth = 1 / 16;
    const opaque = (x, y) => x >= 0 && y >= 0 && x < S && y < S && img && img.data[(y * S + x) * 4 + 3] > 127;
    const quad = (p, n, uv) => {
      const idx = [0, 1, 2, 0, 2, 3];
      for (const i of idx) {
        positions.push(...p[i]);
        normals.push(...n);
        uvs.push(...uv[i]);
      }
    };
    // Front and back faces covering the whole image (alpha tested).
    quad([[0, 0, depth / 2], [1, 0, depth / 2], [1, 1, depth / 2], [0, 1, depth / 2]], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    quad([[1, 0, -depth / 2], [0, 0, -depth / 2], [0, 1, -depth / 2], [1, 1, -depth / 2]], [0, 0, -1], [[1, 0], [0, 0], [0, 1], [1, 1]]);
    // Edge faces along pixel borders give the item thickness.
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!opaque(x, y)) continue;
        const u = (x + 0.5) / S;
        const v = 1 - (y + 0.5) / S;
        const x0 = x / S;
        const x1 = (x + 1) / S;
        const y0 = 1 - (y + 1) / S;
        const y1 = 1 - y / S;
        const z0 = -depth / 2;
        const z1 = depth / 2;
        const uv4 = [[u, v], [u, v], [u, v], [u, v]];
        if (!opaque(x - 1, y)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], uv4);
        if (!opaque(x + 1, y)) quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], uv4);
        if (!opaque(x, y - 1)) quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], uv4);
        if (!opaque(x, y + 1)) quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], uv4);
      }
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.translate(-0.5, -0.5, 0);
    this.geometryCache.set(itemId, geo);
    return geo;
  }

  /** @private */
  rebuild(itemId) {
    if (this.mesh) {
      this.pivot.remove(this.mesh);
      if (this.material && this.material !== this.armMaterial) this.material.dispose();
    }
    this.currentId = itemId;
    const item = itemId ? itemRegistry.get(itemId) : null;
    const blockId = item?.blockId ?? 0;
    if (!item) {
      this.material = this.armMaterial;
      this.mesh = new THREE.Mesh(this.armGeometry, this.armMaterial);
      this.mesh.position.set(0.1, -0.08, 0.05);
      this.mesh.rotation.set(0.25, -0.2, 0.1);
      this.kind = 'arm';
    } else if (blockId && blockRegistry.shape[blockId] !== Shape.CROSS && blockRegistry.shape[blockId] !== Shape.TORCH) {
      this.material = new THREE.MeshLambertMaterial({ map: this.entityRenderer.cubeTexture(blockId), alphaTest: 0.1 });
      this.mesh = new THREE.Mesh(this.entityRenderer.cubeGeometry, this.material);
      this.mesh.scale.setScalar(0.34);
      this.mesh.position.set(0.04, -0.02, 0);
      this.mesh.rotation.set(0, Math.PI / 4, 0);
      this.kind = 'block';
    } else {
      const tex = this.entityRenderer.spriteTexture(itemId);
      this.material = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
      this.mesh = new THREE.Mesh(this.extruded(itemId), this.material);
      this.mesh.scale.setScalar(0.55);
      this.mesh.rotation.set(0, -Math.PI / 2 + 0.3, Math.PI / 5);
      this.kind = item.tool ? 'tool' : 'item';
    }
    this.pivot.add(this.mesh);
  }

  /**
   * Updates animation state.
   * @param {number} dt
   * @param {object} state
   * @param {number} state.itemId held item id (0 = empty hand)
   * @param {number} state.swing remaining swing time (0..0.3)
   * @param {{amount:number, phase:number}} state.bob camera bob state
   * @param {number} state.brightness 0..1 light at the player
   * @param {boolean} state.eating
   * @param {number} state.aspect viewport aspect ratio
   */
  update(dt, { itemId, swing, bob, brightness, eating, aspect }) {
    if (itemId !== this.currentId) {
      // The new item rises into view from below.
      this.rebuild(itemId);
      this.equip = 0;
    }
    this.equip += (1 - this.equip) * damp(10, dt);
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    const s = swing > 0 ? 1 - swing / 0.3 : 0;
    const swingArc = Math.sin(s * Math.PI);
    const swingSqrt = Math.sin(Math.sqrt(s) * Math.PI);
    const bobX = Math.sin(bob.phase) * 0.02 * bob.amount;
    const bobY = -Math.abs(Math.cos(bob.phase)) * 0.025 * bob.amount;
    const eat = eating ? Math.abs(Math.sin(performance.now() / 90)) * 0.05 : 0;
    this.pivot.position.set(
      0.52 + bobX - swingSqrt * 0.25 - (eating ? 0.25 : 0),
      -0.48 + bobY + swingSqrt * 0.12 - (1 - this.equip) * 0.6 + eat + (eating ? 0.1 : 0),
      -0.75 - swingArc * 0.15,
    );
    this.pivot.rotation.set(-swingArc * 0.9, 0.3 - swingSqrt * 0.5, swingArc * 0.3);
    const b = 0.25 + 0.75 * brightness;
    this.ambient.intensity = 1.3 * b;
    this.light.intensity = 2.2 * b;
  }

  /**
   * Draws the overlay on top of the already rendered frame.
   * @param {THREE.WebGLRenderer} webgl
   */
  render(webgl) {
    const autoClear = webgl.autoClear;
    webgl.autoClear = false;
    webgl.clearDepth();
    webgl.render(this.scene, this.camera);
    webgl.autoClear = autoClear;
  }

  /** Releases GPU resources. */
  dispose() {
    for (const g of this.geometryCache.values()) g.dispose();
    this.armGeometry.dispose();
    this.armMaterial.dispose();
    if (this.material && this.material !== this.armMaterial) this.material.dispose();
  }
}
