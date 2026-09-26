import * as THREE from 'three';
import { blockRegistry, DESTROY_TEXTURES } from '../blocks/index.js';

/**
 * Selection outline around the targeted block plus the progressive crack
 * overlay shown while mining.
 */

const crackVertex = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const crackFragment = /* glsl */ `
uniform highp sampler2DArray uAtlas;
uniform float uLayer;
in vec2 vUv;
void main() {
  vec4 t = texture(uAtlas, vec3(vUv, uLayer));
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, 0.62);
}
`;

export class BlockHighlight {
  /**
   * @param {THREE.DataArrayTexture} atlas block texture array
   */
  constructor(atlas) {
    this.group = new THREE.Group();
    this.group.name = 'highlight';
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.outline.renderOrder = 30;
    this.crackUniforms = { uAtlas: { value: atlas }, uLayer: { value: DESTROY_TEXTURES[0] } };
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.crackUniforms,
        vertexShader: crackVertex,
        fragmentShader: crackFragment,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
    );
    this.crack.renderOrder = 31;
    this.group.add(this.outline, this.crack);
    this.group.visible = false;
  }

  /**
   * @param {import('../physics/VoxelRaycast.js').RayHit|null} target
   * @param {number} crackStage -1 for none, 0..9
   */
  update(target, crackStage) {
    if (!target) {
      this.group.visible = false;
      return;
    }
    const sel = blockRegistry.get(target.id).selection ?? [0, 0, 0, 1, 1, 1];
    const e = 0.002;
    const sx = sel[3] - sel[0];
    const sy = sel[4] - sel[1];
    const sz = sel[5] - sel[2];
    this.group.visible = true;
    this.outline.position.set(target.x + sel[0] + sx / 2, target.y + sel[1] + sy / 2, target.z + sel[2] + sz / 2);
    this.outline.scale.set(sx + e * 2, sy + e * 2, sz + e * 2);
    if (crackStage >= 0) {
      this.crack.visible = true;
      this.crack.position.copy(this.outline.position);
      this.crack.scale.set(sx + e, sy + e, sz + e);
      this.crackUniforms.uLayer.value = DESTROY_TEXTURES[crackStage];
    } else {
      this.crack.visible = false;
    }
  }

  /** Releases GPU resources. */
  dispose() {
    this.outline.geometry.dispose();
    this.outline.material.dispose();
    this.crack.geometry.dispose();
    this.crack.material.dispose();
  }
}
