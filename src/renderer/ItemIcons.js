import { blockRegistry } from '../blocks/index.js';
import { Shape, Tint } from '../blocks/BlockShapes.js';
import { itemRegistry } from '../items/index.js';
import { paintItemTexture } from './textures/ItemTextures.js';
import { TINT_LUT } from '../terrain/BiomeColors.js';
import { TINT_ALPHA } from './textures/PixelImage.js';

/**
 * Generates inventory icons for every item: isometric cubes for blocks,
 * flat sprites for plants/torches and pixel-art for tools and materials.
 * Also keeps the 16×16 source image of each item for world sprites.
 */

const SIZE = 48;
/** Default biome climate used to tint icons (temperate plains). */
const ICON_CLIMATE = (10 << 4) | 8;

export class ItemIcons {
  /**
   * @param {import('./textures/BlockTextureArray.js').BlockTextureArray} blockTextures
   */
  constructor(blockTextures) {
    this.blockTextures = blockTextures;
    /** @type {Map<number, string>} data URLs */
    this.urls = new Map();
    /** @type {Map<number, HTMLCanvasElement>} */
    this.canvases = new Map();
    /** 16×16 flat images for sprites. @type {Map<number, import('./textures/PixelImage.js').PixelImage>} */
    this.flat = new Map();
    for (const item of itemRegistry.all()) this.build(item);
  }

  /** @private */
  build(item) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (item.blockId) {
      const def = blockRegistry.get(item.blockId);
      if (def.shape === Shape.CROSS || def.shape === Shape.TORCH) {
        const img = this.tintedTexture(blockRegistry.textureOf(def.id, 0), def.tint);
        this.flat.set(item.id, img);
        ctx.drawImage(toCanvas(img), 0, 0, 16, 16, 0, 0, SIZE, SIZE);
      } else {
        this.drawCube(ctx, def);
        const side = this.tintedTexture(blockRegistry.textureOf(def.id, 4), def.tint);
        this.flat.set(item.id, side);
      }
    } else {
      const img = paintItemTexture(item.icon);
      if (img) {
        this.flat.set(item.id, img);
        ctx.drawImage(toCanvas(img), 0, 0, 16, 16, 0, 0, SIZE, SIZE);
      }
    }
    this.canvases.set(item.id, canvas);
    this.urls.set(item.id, canvas.toDataURL());
  }

  /**
   * Copy of a block texture with a default biome tint baked in.
   * @param {number} layer texture layer
   * @param {number} tintKind one of {@link Tint}
   * @returns {import('./textures/PixelImage.js').PixelImage}
   */
  tintedTexture(layer, tintKind) {
    const img = this.blockTextures.image(layer).clone();
    const color = tintKind !== Tint.NONE ? TINT_LUT[tintKind][ICON_CLIMATE] : 0xffffff;
    const tr = ((color >> 16) & 255) / 255;
    const tg = ((color >> 8) & 255) / 255;
    const tb = (color & 255) / 255;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== TINT_ALPHA) continue;
      if (tintKind !== Tint.NONE) {
        d[i] *= tr;
        d[i + 1] *= tg;
        d[i + 2] *= tb;
      }
      d[i + 3] = 255;
    }
    return img;
  }

  /** Draws an isometric cube. @private */
  drawCube(ctx, def) {
    const top = toCanvas(this.tintedTexture(blockRegistry.textureOf(def.id, 2), def.tint));
    const left = toCanvas(this.tintedTexture(blockRegistry.textureOf(def.id, 4), def.tint));
    const right = toCanvas(this.tintedTexture(blockRegistry.textureOf(def.id, 0), def.tint));
    const s = SIZE / 48;
    const faces = [
      // [image, a, b, c, d, e, f, shade]
      [top, 22 / 16, -11.5 / 16, 22 / 16, 11.5 / 16, 2, 12.5, 0],
      [left, 22 / 16, 11.5 / 16, 0, 23 / 16, 2, 12.5, 0.2],
      [right, 22 / 16, -11.5 / 16, 0, 23 / 16, 24, 24, 0.38],
    ];
    for (const [img, a, b, c, d, e, f, dark] of faces) {
      ctx.save();
      ctx.setTransform(a * s, b * s, c * s, d * s, e * s, f * s);
      ctx.drawImage(img, 0, 0);
      if (dark > 0) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(0,0,0,${dark})`;
        ctx.fillRect(0, 0, 16, 16);
      }
      ctx.restore();
    }
  }

  /**
   * Data URL of an item's icon.
   * @param {number} itemId
   * @returns {string}
   */
  url(itemId) {
    return this.urls.get(itemId) ?? '';
  }

  /**
   * Flat 16×16 image of an item (sprites, held items).
   * @param {number} itemId
   * @returns {import('./textures/PixelImage.js').PixelImage|undefined}
   */
  image(itemId) {
    return this.flat.get(itemId);
  }
}

/**
 * Converts a PixelImage to a canvas.
 * @param {import('./textures/PixelImage.js').PixelImage} img
 * @returns {HTMLCanvasElement}
 */
export function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.size;
  c.height = img.size;
  const ctx = c.getContext('2d');
  const data = ctx.createImageData(img.size, img.size);
  data.data.set(img.data);
  ctx.putImageData(data, 0, 0);
  return c;
}
