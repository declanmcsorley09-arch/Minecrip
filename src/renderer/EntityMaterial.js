import * as THREE from 'three';

/**
 * Lambert material for entities that also respects voxel lighting: the
 * scene's sun/moon and sky lights are attenuated by the sky light level at
 * the entity (so mobs darken in caves) and torch light is added on top,
 * matching how chunk terrain is lit.
 */

const TORCH = new THREE.Color(1.05, 0.83, 0.6);

/**
 * Creates a voxel-lit Lambert material.
 * @param {THREE.MeshLambertMaterialParameters} params
 * @returns {THREE.MeshLambertMaterial & {voxel: {sky: {value:number}, block: {value: THREE.Color}}}}
 */
export function createEntityMaterial(params) {
  const material = new THREE.MeshLambertMaterial(params);
  const voxel = { sky: { value: 1 }, block: { value: new THREE.Color(0, 0, 0) } };
  material.voxel = voxel;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVoxelSky = voxel.sky;
    shader.uniforms.uVoxelBlock = voxel.block;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uVoxelSky;\nuniform vec3 uVoxelBlock;')
      .replace('#include <opaque_fragment>', 'outgoingLight = outgoingLight * uVoxelSky + diffuseColor.rgb * uVoxelBlock;\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'voxel-entity';
  return material;
}

/**
 * Sets the voxel light terms from a packed light byte.
 * @param {ReturnType<typeof createEntityMaterial>} material
 * @param {number} packed sky << 4 | block
 */
export function setEntityLight(material, packed) {
  const sky = (packed >> 4) / 15;
  const block = (packed & 15) / 15;
  material.voxel.sky.value = 0.06 + 0.94 * sky * sky;
  const b = block * block * (1.15 - 0.15 * block);
  material.voxel.block.value.copy(TORCH).multiplyScalar(b);
}
