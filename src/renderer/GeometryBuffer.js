/**
 * Growable vertex/index storage used by the chunk mesher. Produces compact
 * typed arrays that are transferred (zero-copy) from workers to the main
 * thread and uploaded directly as Three.js buffer attributes.
 *
 * Vertex layout:
 * - position  Float32 ×3  (section-local, 0..16)
 * - normal    Int8    ×3  (normalised)
 * - uv        Float32 ×2  (in block units; the texture repeats per block)
 * - layer     Uint16  ×1  (texture array layer)
 * - light     Uint8   ×4  (sky×4, block×4, ambient occlusion 0..3, flags)
 * - tint      Uint8   ×3  (biome colour, sRGB)
 */

/** Vertex flag: vertex sways in the wind (plants). */
export const FLAG_SWAY = 1;
/** Vertex flag: belongs to an exposed water surface (animated waves). */
export const FLAG_WATER_SURFACE = 2;
/** Vertex flag: belongs to water (special shading). */
export const FLAG_WATER = 4;

export class GeometryBuffer {
  /**
   * @param {number} [initialVertices=2048]
   */
  constructor(initialVertices = 2048) {
    this.capacity = 0;
    this.vertexCount = 0;
    this.indexCount = 0;
    this.allocate(initialVertices);
  }

  /** @private */
  allocate(cap) {
    const old = this.capacity > 0 ? this : null;
    const positions = new Float32Array(cap * 3);
    const normals = new Int8Array(cap * 3);
    const uvs = new Float32Array(cap * 2);
    const layers = new Uint16Array(cap);
    const lights = new Uint8Array(cap * 4);
    const tints = new Uint8Array(cap * 3);
    const indices = new Uint32Array(cap * 1.5);
    if (old) {
      positions.set(old.positions);
      normals.set(old.normals);
      uvs.set(old.uvs);
      layers.set(old.layers);
      lights.set(old.lights);
      tints.set(old.tints);
      indices.set(old.indices);
    }
    this.positions = positions;
    this.normals = normals;
    this.uvs = uvs;
    this.layers = layers;
    this.lights = lights;
    this.tints = tints;
    this.indices = indices;
    this.capacity = cap;
  }

  /** Clears contents, keeping allocated memory. */
  reset() {
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  /**
   * Ensures room for `n` more vertices.
   * @param {number} n
   */
  ensure(n) {
    if (this.vertexCount + n > this.capacity) {
      let cap = this.capacity * 2;
      while (this.vertexCount + n > cap) cap *= 2;
      this.allocate(cap);
    }
  }

  /**
   * Appends one vertex.
   * @returns {number} vertex index
   */
  vertex(x, y, z, nx, ny, nz, u, v, layer, sky, block, ao, flags, tint) {
    const i = this.vertexCount++;
    const p = i * 3;
    this.positions[p] = x;
    this.positions[p + 1] = y;
    this.positions[p + 2] = z;
    this.normals[p] = nx;
    this.normals[p + 1] = ny;
    this.normals[p + 2] = nz;
    this.tints[p] = (tint >> 16) & 255;
    this.tints[p + 1] = (tint >> 8) & 255;
    this.tints[p + 2] = tint & 255;
    this.uvs[i * 2] = u;
    this.uvs[i * 2 + 1] = v;
    this.layers[i] = layer;
    const l = i * 4;
    this.lights[l] = sky;
    this.lights[l + 1] = block;
    this.lights[l + 2] = ao;
    this.lights[l + 3] = flags;
    return i;
  }

  /**
   * Appends two triangles for a quad whose 4 vertices were just added.
   * @param {number} base index of the first vertex
   * @param {boolean} flip use the 1-3 diagonal instead of 0-2
   */
  quad(base, flip) {
    const idx = this.indices;
    let k = this.indexCount;
    if (flip) {
      idx[k++] = base + 1;
      idx[k++] = base + 2;
      idx[k++] = base + 3;
      idx[k++] = base + 1;
      idx[k++] = base + 3;
      idx[k++] = base;
    } else {
      idx[k++] = base;
      idx[k++] = base + 1;
      idx[k++] = base + 2;
      idx[k++] = base;
      idx[k++] = base + 2;
      idx[k++] = base + 3;
    }
    this.indexCount = k;
  }

  /**
   * Copies the used portion into tightly sized arrays.
   * @returns {MeshData|null} null when empty
   */
  finish() {
    const n = this.vertexCount;
    if (n === 0) return null;
    const indices = n <= 65535 ? new Uint16Array(this.indexCount) : new Uint32Array(this.indexCount);
    for (let i = 0; i < this.indexCount; i++) indices[i] = this.indices[i];
    return {
      positions: this.positions.slice(0, n * 3),
      normals: this.normals.slice(0, n * 3),
      uvs: this.uvs.slice(0, n * 2),
      layers: this.layers.slice(0, n),
      lights: this.lights.slice(0, n * 4),
      tints: this.tints.slice(0, n * 3),
      indices,
    };
  }
}

/**
 * @typedef {object} MeshData
 * @property {Float32Array} positions
 * @property {Int8Array} normals
 * @property {Float32Array} uvs
 * @property {Uint16Array} layers
 * @property {Uint8Array} lights
 * @property {Uint8Array} tints
 * @property {Uint16Array|Uint32Array} indices
 */

/**
 * Lists the transferable buffers of a mesh (for postMessage).
 * @param {MeshData|null} mesh
 * @param {ArrayBuffer[]} out
 */
export function collectTransferables(mesh, out) {
  if (!mesh) return;
  out.push(mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.layers.buffer, mesh.lights.buffer, mesh.tints.buffer, mesh.indices.buffer);
}
