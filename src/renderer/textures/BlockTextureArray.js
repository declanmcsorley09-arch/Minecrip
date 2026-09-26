import * as THREE from 'three';
import { paintBlockTexture, averageColor } from './BlockTextures.js';
import { TINT_ALPHA } from './PixelImage.js';
import { RenderLayer } from '../../blocks/BlockShapes.js';

/**
 * Builds the WebGL2 texture array holding every block texture (one 16×16
 * layer each). A texture array lets greedy-meshed quads repeat a texture
 * across many blocks without atlas bleeding.
 *
 * Mip levels are computed manually: cutout textures keep their coverage
 * (so foliage doesn't dissolve at distance) and the alpha-encoded biome tint
 * mask survives every level.
 */

const SIZE = 16;
const LEVELS = 5; // 16, 8, 4, 2, 1

export class BlockTextureArray {
  /**
   * @param {import('../../blocks/BlockRegistry.js').BlockRegistry} registry
   */
  constructor(registry) {
    this.registry = registry;
    const names = registry.textureNames;
    this.count = names.length;
    /** @type {import('./PixelImage.js').PixelImage[]} */
    this.images = names.map((n) => paintBlockTexture(n, registry.textureColors.get(n)));
    /** Average colour per layer (particles). */
    this.averageColors = this.images.map(averageColor);

    const translucent = new Set();
    for (const def of registry.all()) {
      if (def.layer === RenderLayer.TRANSLUCENT && def.faceTextures) for (const t of def.faceTextures) translucent.add(t);
    }
    this.levels = [];
    for (let l = 0; l < LEVELS; l++) {
      const s = SIZE >> l;
      this.levels.push(new Uint8Array(s * s * 4 * this.count));
    }
    names.forEach((name, layer) => this.buildLayer(layer, this.images[layer], translucent.has(name)));

    const tex = new THREE.DataArrayTexture(this.levels[0], SIZE, SIZE, this.count);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this.texture = tex;
    /** Renderer the GPU copy currently belongs to. */
    this.uploadedTo = null;
  }

  /**
   * Writes a layer's base level and custom mips. Image rows are flipped so
   * the top of the painted image maps to v = 1.
   * @private
   */
  buildLayer(layer, img, translucent) {
    for (let l = 0; l < LEVELS; l++) {
      const s = SIZE >> l;
      const block = 1 << l;
      const out = this.levels[l];
      const layerOffset = layer * s * s * 4;
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          let visible = 0;
          let tinted = 0;
          for (let dy = 0; dy < block; dy++) {
            for (let dx = 0; dx < block; dx++) {
              const src = ((y * block + dy) * SIZE + (x * block + dx)) * 4;
              const pa = img.data[src + 3];
              if (translucent) {
                r += img.data[src];
                g += img.data[src + 1];
                b += img.data[src + 2];
                a += pa;
                visible++;
                continue;
              }
              if (pa === 0) continue;
              visible++;
              if (pa < 230) tinted++;
              r += img.data[src];
              g += img.data[src + 1];
              b += img.data[src + 2];
            }
          }
          const total = block * block;
          const dst = layerOffset + ((s - 1 - y) * s + x) * 4;
          if (translucent) {
            out[dst] = r / total;
            out[dst + 1] = g / total;
            out[dst + 2] = b / total;
            out[dst + 3] = a / total;
          } else if (visible === 0 || visible / total < 0.4) {
            out[dst] = visible ? r / visible : 0;
            out[dst + 1] = visible ? g / visible : 0;
            out[dst + 2] = visible ? b / visible : 0;
            out[dst + 3] = 0;
          } else {
            out[dst] = r / visible;
            out[dst + 1] = g / visible;
            out[dst + 2] = b / visible;
            out[dst + 3] = tinted * 2 > visible ? TINT_ALPHA : 255;
          }
        }
      }
    }
  }

  /**
   * Uploads the texture and replaces the auto-generated mip chain with the
   * custom one. Must be called once after the renderer exists.
   * @param {THREE.WebGLRenderer} renderer
   */
  upload(renderer) {
    if (this.uploadedTo === renderer) return;
    this.texture.needsUpdate = true;
    renderer.initTexture(this.texture);
    const gl = renderer.getContext();
    const props = renderer.properties.get(this.texture);
    const glTex = props.__webglTexture;
    if (!glTex) return;
    renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, glTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let l = 1; l < LEVELS; l++) {
      const s = SIZE >> l;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, 0, 0, 0, s, s, this.count, gl.RGBA, gl.UNSIGNED_BYTE, this.levels[l]);
    }
    this.uploadedTo = renderer;
  }

  /**
   * Returns the base RGBA image of a layer (for UI icons and particles).
   * @param {number} layer
   * @returns {import('./PixelImage.js').PixelImage}
   */
  image(layer) {
    return this.images[layer];
  }

  /** Releases the GPU copy (CPU images are kept for reuse by later sessions). */
  releaseGpu() {
    this.texture.dispose();
    this.uploadedTo = null;
  }
}
