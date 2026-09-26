import * as THREE from 'three';
import {
  chunkVertexShader,
  chunkFragmentShader,
  cutoutDepthVertexShader,
  cutoutDepthFragmentShader,
} from './shaders/chunkShaders.js';

/**
 * The shader materials used for chunk sections. All materials share the
 * same uniform objects, so the day/night cycle updates one place.
 */
export class ChunkMaterials {
  /**
   * @param {THREE.DataArrayTexture} atlas block texture array
   */
  constructor(atlas) {
    /** Shared uniform value holders. */
    this.shared = {
      uAtlas: { value: atlas },
      uTime: { value: 0 },
      uWind: { value: 1 },
      uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.2).normalize() },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSkyLight: { value: new THREE.Color(0.55, 0.62, 0.75) },
      uBlockLight: { value: new THREE.Color(1.0, 0.82, 0.6) },
      uMinLight: { value: 0.018 },
      uShadowStrength: { value: 0.75 },
      uSkyReflect: { value: new THREE.Color(0.5, 0.7, 1.0) },
      uUnderwater: { value: 0 },
    };

    this.opaque = this.create({});
    this.cutout = this.create({ CUTOUT: '' });
    this.translucent = this.create({ TRANSLUCENT: '' }, {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.cutoutDepth = new THREE.ShaderMaterial({
      uniforms: { uAtlas: this.shared.uAtlas, uTime: this.shared.uTime, uWind: this.shared.uWind },
      vertexShader: cutoutDepthVertexShader,
      fragmentShader: cutoutDepthFragmentShader,
    });
  }

  /**
   * @private
   * @param {Record<string,string>} defines
   * @param {object} [extra] material parameters
   * @returns {THREE.ShaderMaterial}
   */
  create(defines, extra = {}) {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
    Object.assign(uniforms, this.shared);
    const material = new THREE.ShaderMaterial({
      uniforms,
      defines,
      vertexShader: chunkVertexShader,
      fragmentShader: chunkFragmentShader,
      lights: true,
      fog: true,
      ...extra,
    });
    return material;
  }

  /**
   * Material for a render layer index (0 opaque, 1 cutout, 2 translucent).
   * @param {number} layer
   * @returns {THREE.ShaderMaterial}
   */
  forLayer(layer) {
    return layer === 0 ? this.opaque : layer === 1 ? this.cutout : this.translucent;
  }

  /** Releases GPU programs. */
  dispose() {
    this.opaque.dispose();
    this.cutout.dispose();
    this.translucent.dispose();
    this.cutoutDepth.dispose();
  }
}
