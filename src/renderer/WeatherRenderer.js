import * as THREE from 'three';
import { BIOMES } from '../terrain/Biomes.js';

/**
 * Rain and snow around the camera.
 *
 * Particles live in a cylinder centred on the player and are recycled when
 * they hit the ground or fall out of range. Each column's precipitation type
 * comes from its biome (none in deserts, snow in cold biomes) and particles
 * never spawn below the terrain height, so roofs keep you dry. Rendered as
 * one instanced draw call; positions are streamed each frame.
 */

const MAX = 2200;
const RADIUS = 18;

const vertexShader = /* glsl */ `
in vec4 aDrop; // xyz position, w = type (0 rain, 1 snow, -1 hidden)
out vec2 vUv;
out float vType;
void main() {
  vType = aDrop.w;
  vUv = uv;
  if (aDrop.w < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 center = aDrop.xyz;
  vec3 toCam = cameraPosition - center;
  vec3 right;
  vec3 up;
  float w;
  float h;
  if (aDrop.w < 0.5) {
    right = normalize(vec3(toCam.z, 0.0, -toCam.x) + 1e-5);
    up = vec3(0.0, 1.0, 0.0);
    w = 0.035;
    h = 0.75;
  } else {
    vec3 f = normalize(toCam);
    right = normalize(cross(vec3(0.0, 1.0, 0.0), f) + 1e-5);
    up = cross(f, right);
    w = 0.11;
    h = 0.11;
  }
  vec3 p = center + right * position.x * w + up * position.y * h;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uBrightness;
in vec2 vUv;
in float vType;
void main() {
  float a;
  vec3 col;
  if (vType < 0.5) {
    a = 0.38 * smoothstep(0.0, 0.4, vUv.y) * (1.0 - abs(vUv.x - 0.5) * 1.6);
    col = vec3(0.72, 0.8, 1.0);
  } else {
    vec2 c = vUv - 0.5;
    a = 0.9 * (1.0 - smoothstep(0.3, 0.5, length(c)));
    col = vec3(1.0);
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(col * uBrightness, a);
  #include <colorspace_fragment>
}
`;

export class WeatherRenderer {
  /**
   * @param {import('../world/World.js').World} world
   */
  constructor(world) {
    this.world = world;
    this.drops = new Float32Array(MAX * 4);
    this.speed = new Float32Array(MAX);
    this.phase = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) this.drops[i * 4 + 3] = -1;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    this.attr = new THREE.InstancedBufferAttribute(this.drops, 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDrop', this.attr);
    geo.instanceCount = MAX;
    this.uniforms = { uBrightness: { value: 1 } };
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'weather';
    /** Fraction of recently spawned drops that reached open sky near the player (0..1). */
    this.exposure = 0;
    /** Fraction of exposed drops that are rain (vs snow). */
    this.rainFraction = 1;
    this.spawnTries = 0;
    this.spawnHits = 0;
    this.rainHits = 0;
  }

  /**
   * Precipitation type for a column: 0 rain, 1 snow, -1 none.
   * @private
   */
  precipitationAt(x, z) {
    const chunk = this.world.getChunk(x >> 4, z >> 4);
    if (!chunk) return -1;
    const biome = BIOMES[chunk.biomes[(x & 15) | ((z & 15) << 4)]];
    if (!biome || biome.precipitation === 'none') return -1;
    return biome.precipitation === 'snow' ? 1 : 0;
  }

  /** @private */
  respawn(i, cam, initial) {
    const o = i * 4;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * RADIUS;
    const x = cam.x + Math.cos(a) * r;
    const z = cam.z + Math.sin(a) * r;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const type = this.precipitationAt(bx, bz);
    const ground = this.world.getHeight(bx, bz);
    const top = cam.y + 14;
    let y = initial ? cam.y - 8 + Math.random() * 24 : top + Math.random() * 6;
    this.spawnTries++;
    if (type < 0 || ground > top) {
      this.drops[o + 3] = -1;
      this.drops[o + 1] = cam.y - 100;
      return;
    }
    if (y < ground) y = ground + Math.random() * (top - ground);
    this.spawnHits++;
    if (type === 0) this.rainHits++;
    this.drops[o] = x;
    this.drops[o + 1] = y;
    this.drops[o + 2] = z;
    this.drops[o + 3] = type;
    this.speed[i] = type === 0 ? 13 + Math.random() * 5 : 1.6 + Math.random() * 0.8;
    this.phase[i] = Math.random() * 10;
  }

  /**
   * Simulates particles for this frame.
   * @param {number} dt seconds
   * @param {THREE.Vector3} cam camera position
   * @param {number} intensity 0..1 precipitation strength
   * @param {number} brightness sky brightness 0..1
   * @param {number} time seconds
   */
  update(dt, cam, intensity, brightness, time) {
    const active = Math.floor(MAX * intensity);
    this.mesh.visible = active > 0;
    this.uniforms.uBrightness.value = 0.25 + 0.75 * brightness;
    const d = this.drops;
    for (let i = 0; i < MAX; i++) {
      const o = i * 4;
      if (i >= active) {
        d[o + 3] = -1;
        continue;
      }
      if (d[o + 3] < 0) {
        this.respawn(i, cam, true);
        continue;
      }
      const snow = d[o + 3] > 0.5;
      d[o + 1] -= this.speed[i] * dt;
      if (snow) {
        d[o] += Math.sin(time * 1.3 + this.phase[i]) * 0.6 * dt;
        d[o + 2] += Math.cos(time * 1.1 + this.phase[i]) * 0.6 * dt;
      }
      const dx = d[o] - cam.x;
      const dz = d[o + 2] - cam.z;
      const ground = this.world.getHeight(Math.floor(d[o]), Math.floor(d[o + 2]));
      if (d[o + 1] < ground || d[o + 1] < cam.y - 12 || dx * dx + dz * dz > RADIUS * RADIUS * 1.2) this.respawn(i, cam, false);
    }
    this.attr.needsUpdate = true;
    // Exponentially smoothed exposure metric for audio.
    if (this.spawnTries > 0) {
      const frac = this.spawnHits / this.spawnTries;
      this.exposure += (frac * intensity - this.exposure) * Math.min(1, dt * 2);
      if (this.spawnHits > 0) this.rainFraction += (this.rainHits / this.spawnHits - this.rainFraction) * Math.min(1, dt * 2);
    } else if (active === 0) {
      this.exposure += (0 - this.exposure) * Math.min(1, dt * 2);
    }
    this.spawnTries = 0;
    this.spawnHits = 0;
    this.rainHits = 0;
  }

  /** Releases GPU resources. */
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
