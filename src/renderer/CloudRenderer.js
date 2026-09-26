import * as THREE from 'three';
import { FractalNoise } from '../utils/noise/FractalNoise.js';

/**
 * Blocky, drifting 3D clouds.
 *
 * A fixed grid of instanced boxes surrounds the camera. The vertex shader
 * samples a tileable coverage texture (scrolled by the wind) to decide which
 * cells are clouds, collapses the rest, and removes faces shared by two
 * cloud cells. Coverage is a uniform, so weather changes are instant and
 * free. No geometry is rebuilt at runtime.
 */

const TEX_SIZE = 128;
const GRID = 28; // cells in each direction from the camera

const vertexShader = /* glsl */ `
in vec2 aCell;
uniform sampler2D uMap;
uniform float uCoverage;
uniform vec2 uBase;
uniform vec2 uWind;
uniform float uCellSize;
uniform float uThickness;
uniform float uAltitude;
out vec3 vNormalC;
out vec3 vWorld;

bool cloudAt(vec2 cell) {
  return texture(uMap, (cell + 0.5) / ${TEX_SIZE}.0).r > 1.0 - uCoverage;
}

void main() {
  vec2 cell = uBase + aCell;
  vec3 n = normal;
  bool hidden = !cloudAt(cell);
  if (!hidden && abs(n.x) > 0.5 && cloudAt(cell + vec2(sign(n.x), 0.0))) hidden = true;
  if (!hidden && abs(n.z) > 0.5 && cloudAt(cell + vec2(0.0, sign(n.z)))) hidden = true;
  if (hidden) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 local = position + 0.5;
  vec3 world = vec3(
    (cell.x + local.x) * uCellSize - uWind.x,
    uAltitude + local.y * uThickness,
    (cell.y + local.z) * uCellSize - uWind.y
  );
  vNormalC = n;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFadeDistance;
uniform float uOpacity;
in vec3 vNormalC;
in vec3 vWorld;
void main() {
  float shade = vNormalC.y > 0.5 ? 1.0 : (vNormalC.y < -0.5 ? 0.7 : (abs(vNormalC.x) > 0.5 ? 0.86 : 0.8));
  float dist = length(vWorld.xz - cameraPosition.xz);
  float fade = smoothstep(uFadeDistance * 0.55, uFadeDistance, dist);
  vec3 col = mix(uColor * shade, uFogColor, fade * 0.85);
  float alpha = uOpacity * (1.0 - fade);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

export class CloudRenderer {
  /**
   * @param {number} seed world seed (cloud layout)
   */
  constructor(seed) {
    this.cellSize = 12;
    this.altitude = 192;
    this.windSpeed = new THREE.Vector2(1.6, 0.6);
    this.wind = new THREE.Vector2();
    this.texture = this.createCoverage(seed);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.getAttribute('position'));
    geo.setAttribute('normal', box.getAttribute('normal'));
    const cells = new Float32Array((GRID * 2) * (GRID * 2) * 2);
    let i = 0;
    for (let z = -GRID; z < GRID; z++) {
      for (let x = -GRID; x < GRID; x++) {
        cells[i++] = x;
        cells[i++] = z;
      }
    }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = (GRID * 2) * (GRID * 2);

    this.uniforms = {
      uMap: { value: this.texture },
      uCoverage: { value: 0.45 },
      uBase: { value: new THREE.Vector2() },
      uWind: { value: new THREE.Vector2() },
      uCellSize: { value: this.cellSize },
      uThickness: { value: 4 },
      uAltitude: { value: this.altitude },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uFogColor: { value: new THREE.Color() },
      uFadeDistance: { value: GRID * this.cellSize },
      uOpacity: { value: 0.82 },
    };
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: true,
        fog: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'clouds';
  }

  /**
   * Builds a tileable coverage map from fractal noise.
   * @private
   */
  createCoverage(seed) {
    const noise = new FractalNoise(seed, { salt: 77, octaves: 4, frequency: 1 / 14 });
    const data = new Uint8Array(TEX_SIZE * TEX_SIZE);
    const S = TEX_SIZE;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // Blend four offset copies so the texture wraps seamlessly.
        const fx = x / S;
        const fy = y / S;
        const v =
          noise.sample2D(x, y) * (1 - fx) * (1 - fy) +
          noise.sample2D(x - S, y) * fx * (1 - fy) +
          noise.sample2D(x, y - S) * (1 - fx) * fy +
          noise.sample2D(x - S, y - S) * fx * fy;
        const norm = v / Math.sqrt((1 - fx) ** 2 + fx ** 2) / Math.sqrt((1 - fy) ** 2 + fy ** 2);
        data[y * S + x] = Math.max(0, Math.min(255, (norm * 0.9 + 0.5) * 255));
      }
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Moves the clouds with the wind and recentres the grid on the camera.
   * @param {number} dt seconds
   * @param {THREE.Camera} camera
   * @param {import('./Atmosphere.js').AtmosphereState} atmo
   * @param {number} weatherRain 0..1 (faster wind in storms)
   */
  update(dt, camera, atmo, weatherRain) {
    const period = TEX_SIZE * this.cellSize;
    const speed = 1 + weatherRain * 1.5;
    this.wind.x = (this.wind.x + this.windSpeed.x * speed * dt) % period;
    this.wind.y = (this.wind.y + this.windSpeed.y * speed * dt) % period;
    const u = this.uniforms;
    u.uWind.value.copy(this.wind);
    u.uBase.value.set(
      Math.floor((camera.position.x + this.wind.x) / this.cellSize),
      Math.floor((camera.position.z + this.wind.y) / this.cellSize),
    );
    u.uCoverage.value = atmo.cloudCoverage;
    u.uColor.value.copy(atmo.cloudColor);
    u.uFogColor.value.copy(atmo.horizon);
  }

  /**
   * @param {boolean} visible
   */
  setVisible(visible) {
    this.mesh.visible = visible;
  }

  /** Releases GPU resources. */
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}
