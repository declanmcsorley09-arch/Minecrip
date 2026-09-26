import * as THREE from 'three';
import { blockRegistry } from '../blocks/index.js';

/**
 * Pooled, instanced particles textured with fragments of block textures
 * (breaking debris, digging chips, landing dust, splashes). One draw call;
 * particles fall, bounce on terrain and fade.
 */

const MAX = 1200;

const vertexShader = /* glsl */ `
#include <fog_pars_vertex>
in vec4 aPos;    // xyz, size
in vec4 aTex;    // u offset, v offset, layer, brightness
in vec3 aTint;
out vec2 vUv;
flat out float vLayer;
out float vBright;
out vec3 vTint;
void main() {
  vUv = aTex.xy + uv * 0.25;
  vLayer = aTex.z;
  vBright = aTex.w;
  vTint = aTint;
  vec4 mvPosition = modelViewMatrix * vec4(aPos.xyz, 1.0);
  mvPosition.xy += position.xy * aPos.w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <fog_pars_fragment>
uniform highp sampler2DArray uAtlas;
in vec2 vUv;
flat in float vLayer;
in float vBright;
in vec3 vTint;
void main() {
  vec4 t = texture(uAtlas, vec3(vUv, vLayer));
  if (t.a < 0.5) discard;
  vec3 tint = t.a < 0.9 ? pow(vTint, vec3(2.2)) : vec3(1.0);
  gl_FragColor = vec4(t.rgb * tint * vBright, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class ParticleSystem {
  /**
   * @param {THREE.DataArrayTexture} atlas
   * @param {import('../world/World.js').World} world
   */
  constructor(atlas, world) {
    this.world = world;
    this.pos = new Float32Array(MAX * 4);
    this.tex = new Float32Array(MAX * 4);
    this.tint = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.gravity = new Float32Array(MAX);
    this.count = 0;

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    this.posAttr = new THREE.InstancedBufferAttribute(this.pos, 4).setUsage(THREE.DynamicDrawUsage);
    this.texAttr = new THREE.InstancedBufferAttribute(this.tex, 4).setUsage(THREE.DynamicDrawUsage);
    this.tintAttr = new THREE.InstancedBufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.posAttr);
    geo.setAttribute('aTex', this.texAttr);
    geo.setAttribute('aTint', this.tintAttr);
    geo.instanceCount = 0;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    uniforms.uAtlas = { value: atlas };
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, fog: true }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.name = 'particles';
    this.skyFactor = 1;
  }

  /** @private */
  spawn(x, y, z, vx, vy, vz, size, layer, life, tint, gravity) {
    if (this.count >= MAX) return;
    const i = this.count++;
    this.pos[i * 4] = x;
    this.pos[i * 4 + 1] = y;
    this.pos[i * 4 + 2] = z;
    this.pos[i * 4 + 3] = size;
    this.tex[i * 4] = Math.floor(Math.random() * 12) / 16;
    this.tex[i * 4 + 1] = Math.floor(Math.random() * 12) / 16;
    this.tex[i * 4 + 2] = layer;
    this.tex[i * 4 + 3] = this.brightnessAt(x, y, z);
    this.tint[i * 3] = ((tint >> 16) & 255) / 255;
    this.tint[i * 3 + 1] = ((tint >> 8) & 255) / 255;
    this.tint[i * 3 + 2] = (tint & 255) / 255;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.gravity[i] = gravity;
  }

  /** @private */
  brightnessAt(x, y, z) {
    const l = this.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    const level = Math.max((l >> 4) * this.skyFactor, l & 15) / 15;
    return 0.08 + 0.92 * level * level;
  }

  /**
   * Particle tint for tintable blocks (temperate colours).
   * @private
   */
  tintOf(blockId) {
    const kind = blockRegistry.tint[blockId];
    if (!kind) return 0xffffff;
    return kind === 3 ? 0x3f76e4 : 0x6ea14a;
  }

  /**
   * Debris when a block breaks.
   * @param {number} bx
   * @param {number} by
   * @param {number} bz
   * @param {number} blockId
   */
  blockBreak(bx, by, bz, blockId) {
    const layerTop = blockRegistry.textureOf(blockId, 2);
    const layerSide = blockRegistry.textureOf(blockId, 4);
    const tint = this.tintOf(blockId);
    for (let ix = 0; ix < 4; ix++) {
      for (let iy = 0; iy < 4; iy++) {
        for (let iz = 0; iz < 4; iz++) {
          const x = bx + (ix + 0.5) / 4;
          const y = by + (iy + 0.5) / 4;
          const z = bz + (iz + 0.5) / 4;
          this.spawn(
            x, y, z,
            (x - bx - 0.5) * 3 + (Math.random() - 0.5), (y - by - 0.5) * 2 + 2 + Math.random() * 1.5, (z - bz - 0.5) * 3 + (Math.random() - 0.5),
            0.08 + Math.random() * 0.06, iy === 3 ? layerTop : layerSide, 0.6 + Math.random() * 0.6, tint, 18,
          );
        }
      }
    }
  }

  /**
   * Small chips while digging a face.
   * @param {import('../physics/VoxelRaycast.js').RayHit} hit
   */
  dig(hit) {
    const layer = blockRegistry.textureOf(hit.id, hit.face);
    const tint = this.tintOf(hit.id);
    for (let i = 0; i < 4; i++) {
      this.spawn(
        hit.px + hit.nx * 0.05 + (Math.random() - 0.5) * 0.3, hit.py + hit.ny * 0.05 + (Math.random() - 0.5) * 0.3, hit.pz + hit.nz * 0.05 + (Math.random() - 0.5) * 0.3,
        hit.nx * 1.5 + (Math.random() - 0.5) * 1.5, hit.ny * 1.5 + Math.random() * 1.5, hit.nz * 1.5 + (Math.random() - 0.5) * 1.5,
        0.06 + Math.random() * 0.04, layer, 0.4 + Math.random() * 0.3, tint, 18,
      );
    }
  }

  /**
   * Dust puff under the feet (landing, sprinting).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} blockId block below
   * @param {number} amount
   */
  dust(x, y, z, blockId, amount) {
    if (!blockId || !blockRegistry.byId[blockId] || blockRegistry.shape[blockId] === 0) return;
    const layer = blockRegistry.textureOf(blockId, 2);
    const tint = this.tintOf(blockId);
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(x + Math.cos(a) * 0.3, y + 0.05, z + Math.sin(a) * 0.3, Math.cos(a) * 1.5, 1 + Math.random(), Math.sin(a) * 1.5, 0.07, layer, 0.5, tint, 12);
    }
  }

  /**
   * Water splash droplets.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} strength
   */
  splash(x, y, z, strength) {
    const layer = blockRegistry.textureOf(blockRegistry.ids.water, 2);
    const n = Math.min(40, 8 + Math.floor(strength * 3));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 2;
      this.spawn(x + Math.cos(a) * 0.4, y, z + Math.sin(a) * 0.4, Math.cos(a) * s, 3 + Math.random() * 3, Math.sin(a) * s, 0.06, layer, 0.7, 0x3f76e4, 20);
    }
  }

  /**
   * Simulates and uploads particles.
   * @param {number} dt
   * @param {number} skyFactor current sky light multiplier (0..1)
   */
  update(dt, skyFactor) {
    this.skyFactor = skyFactor;
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const p = i * 4;
      const v = i * 3;
      this.vel[v + 1] -= this.gravity[i] * dt;
      const drag = Math.exp(-1.2 * dt);
      this.vel[v] *= drag;
      this.vel[v + 2] *= drag;
      const nx = this.pos[p] + this.vel[v] * dt;
      const ny = this.pos[p + 1] + this.vel[v + 1] * dt;
      const nz = this.pos[p + 2] + this.vel[v + 2] * dt;
      const id = this.world.getBlock(Math.floor(nx), Math.floor(ny - this.pos[p + 3] * 0.5), Math.floor(nz));
      if (id && blockRegistry.solid[id]) {
        this.vel[v] *= 0.4;
        this.vel[v + 2] *= 0.4;
        this.vel[v + 1] = 0;
      } else {
        this.pos[p] = nx;
        this.pos[p + 1] = ny;
        this.pos[p + 2] = nz;
      }
      i++;
    }
    const geo = this.mesh.geometry;
    geo.instanceCount = this.count;
    if (this.count > 0) {
      this.posAttr.addUpdateRange(0, this.count * 4);
      this.posAttr.needsUpdate = true;
      this.texAttr.addUpdateRange(0, this.count * 4);
      this.texAttr.needsUpdate = true;
      this.tintAttr.addUpdateRange(0, this.count * 3);
      this.tintAttr.needsUpdate = true;
    }
  }

  /** Swap-removes particle i. @private */
  kill(i) {
    const last = --this.count;
    if (i === last) return;
    for (let k = 0; k < 4; k++) {
      this.pos[i * 4 + k] = this.pos[last * 4 + k];
      this.tex[i * 4 + k] = this.tex[last * 4 + k];
    }
    for (let k = 0; k < 3; k++) {
      this.vel[i * 3 + k] = this.vel[last * 3 + k];
      this.tint[i * 3 + k] = this.tint[last * 3 + k];
    }
    this.life[i] = this.life[last];
    this.gravity[i] = this.gravity[last];
  }

  /** Releases GPU resources. */
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
