/**
 * Tiny RGBA raster used by the procedural texture painters. Row 0 is the top
 * of the image. Alpha conventions used by block textures:
 * - 255: opaque, untinted
 * - {@link TINT_ALPHA}: opaque, multiplied by the biome tint
 * - 0: transparent (discarded for cutout blocks)
 */

/** Alpha value marking a texel as biome-tintable. */
export const TINT_ALPHA = 204;

export class PixelImage {
  /**
   * @param {number} [size=16]
   */
  constructor(size = 16) {
    this.size = size;
    this.data = new Uint8ClampedArray(size * size * 4);
  }

  /**
   * Writes a pixel (coordinates wrap around).
   * @param {number} x
   * @param {number} y
   * @param {number[]} c [r, g, b] or [r, g, b, a]
   */
  set(x, y, c) {
    const s = this.size;
    const i = ((((y % s) + s) % s) * s + (((x % s) + s) % s)) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c.length > 3 ? c[3] : 255;
  }

  /**
   * Reads a pixel.
   * @param {number} x
   * @param {number} y
   * @returns {number[]} [r, g, b, a]
   */
  get(x, y) {
    const s = this.size;
    const i = ((((y % s) + s) % s) * s + (((x % s) + s) % s)) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /**
   * Applies a function to every pixel.
   * @param {(x:number, y:number) => number[]|null} fn returns a colour or null to skip
   */
  paint(fn) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const c = fn(x, y);
        if (c) this.set(x, y, c);
      }
    }
  }

  /**
   * Copies another image on top of this one (respects source transparency).
   * @param {PixelImage} other
   */
  overlay(other) {
    for (let i = 0; i < this.data.length; i += 4) {
      if (other.data[i + 3] === 0) continue;
      this.data[i] = other.data[i];
      this.data[i + 1] = other.data[i + 1];
      this.data[i + 2] = other.data[i + 2];
      this.data[i + 3] = other.data[i + 3];
    }
  }

  /**
   * Returns a deep copy.
   * @returns {PixelImage}
   */
  clone() {
    const img = new PixelImage(this.size);
    img.data.set(this.data);
    return img;
  }
}

/**
 * Parses '#rrggbb' or 0xrrggbb into [r, g, b].
 * @param {string|number} hex
 * @returns {number[]}
 */
export function rgb(hex) {
  const n = typeof hex === 'number' ? hex : parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Multiplies a colour's brightness.
 * @param {number[]} c
 * @param {number} f
 * @returns {number[]}
 */
export function shade(c, f) {
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f), c.length > 3 ? c[3] : 255];
}

/**
 * Linear blend of two colours.
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} t
 * @returns {number[]}
 */
export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Returns the colour with a specific alpha.
 * @param {number[]} c
 * @param {number} a
 * @returns {number[]}
 */
export function withAlpha(c, a) {
  return [c[0], c[1], c[2], a];
}
