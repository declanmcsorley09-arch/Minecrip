import * as THREE from 'three';
import { SeededRandom } from '../utils/random.js';
import {
  skyVertexShader,
  skyFragmentShader,
  celestialVertexShader,
  sunFragmentShader,
  moonFragmentShader,
  starVertexShader,
  starFragmentShader,
} from './shaders/skyShaders.js';

/**
 * Procedural sky: gradient dome, sun, phased moon and a star field that
 * rotates with the celestial sphere. Everything is drawn behind the world
 * (negative render order, no depth test) and follows the camera.
 */
export class SkyRenderer {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'sky';

    this.domeUniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uGlowColor: { value: new THREE.Color(1, 0.5, 0.2) },
      uGlow: { value: 0 },
      uFlash: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.domeUniforms,
        vertexShader: skyVertexShader,
        fragmentShader: skyFragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    this.dome = dome;
    this.group.add(dome);

    // Stars live on a rotating sphere.
    this.celestial = new THREE.Group();
    this.group.add(this.celestial);
    this.starUniforms = { uOpacity: { value: 0 }, uTime: { value: 0 } };
    this.stars = this.createStars(1600);
    this.celestial.add(this.stars);

    this.sunUniforms = { uColor: { value: new THREE.Color(1, 0.95, 0.8) }, uOpacity: { value: 1 } };
    this.sun = this.createBillboard(sunFragmentShader, this.sunUniforms, 70, -98);
    this.moonUniforms = {
      uMap: { value: createMoonTexture() },
      uPhase: { value: 0 },
      uOpacity: { value: 1 },
    };
    this.moon = this.createBillboard(moonFragmentShader, this.moonUniforms, 60, -97);
    this.group.add(this.sun, this.moon);
  }

  /** @private */
  createStars(count) {
    const rng = new SeededRandom(0x57a2);
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Uniform points on a sphere.
      const u = rng.next() * 2 - 1;
      const t = rng.next() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      positions[i * 3] = s * Math.cos(t) * 400;
      positions[i * 3 + 1] = u * 400;
      positions[i * 3 + 2] = s * Math.sin(t) * 400;
      sizes[i] = rng.next() < 0.1 ? 3 : rng.next() < 0.4 ? 2 : 1.4;
      phases[i] = rng.next() * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    const points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.starUniforms,
        vertexShader: starVertexShader,
        fragmentShader: starFragmentShader,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    points.renderOrder = -99;
    points.frustumCulled = false;
    return points;
  }

  /** @private */
  createBillboard(fragmentShader, uniforms, size, order) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: celestialVertexShader,
        fragmentShader,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Updates the sky for the current frame.
   * @param {THREE.Camera} camera
   * @param {import('./Atmosphere.js').AtmosphereState} atmo
   * @param {number} time seconds (for twinkling)
   */
  update(camera, atmo, time) {
    // Underwater the view ends in fog; the sky would show through past it.
    this.group.visible = !atmo.underwater;
    this.group.position.copy(camera.position);
    const u = this.domeUniforms;
    u.uZenith.value.copy(atmo.zenith);
    u.uHorizon.value.copy(atmo.horizon);
    u.uGround.value.copy(atmo.ground);
    u.uSunDir.value.copy(atmo.sunDir);
    u.uGlowColor.value.copy(atmo.glowColor);
    u.uGlow.value = atmo.glow;
    u.uFlash.value = atmo.flash;

    this.starUniforms.uOpacity.value = atmo.starVisibility;
    this.starUniforms.uTime.value = time;
    this.celestial.rotation.set(0, 0, atmo.sunAngle);

    this.sun.position.copy(atmo.sunDir).multiplyScalar(420);
    this.group.updateMatrixWorld();
    this.sun.lookAt(camera.position);
    this.sunUniforms.uColor.value.copy(atmo.sunDiscColor);
    this.sunUniforms.uOpacity.value = atmo.celestialVisibility;

    this.moon.position.copy(atmo.sunDir).multiplyScalar(-420);
    this.moon.lookAt(camera.position);
    this.moonUniforms.uPhase.value = atmo.moonPhase / 8;
    this.moonUniforms.uOpacity.value = atmo.celestialVisibility;
  }

  /** Releases GPU resources. */
  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.moonUniforms.uMap.value.dispose();
  }
}

/**
 * Paints a cratered moon texture.
 * @returns {THREE.CanvasTexture}
 */
function createMoonTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rng = new SeededRandom(0x3007);
  const craters = [];
  for (let i = 0; i < 14; i++) craters.push([rng.range(18, 46), rng.range(18, 46), rng.range(1.5, 5)]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let v = 205 + rng.next() * 25;
      for (const [cx, cy, r] of craters) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r) v -= 45 * (1 - d / r);
        else if (d < r + 1) v += 12;
      }
      img.data[i] = v * 0.97;
      img.data[i + 1] = v;
      img.data[i + 2] = v * 1.04;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
