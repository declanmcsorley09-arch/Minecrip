import { blockRegistry, BlockIds } from '../blocks/index.js';
import { Shape, RenderLayer } from '../blocks/BlockShapes.js';
import { TINT_LUT } from '../terrain/BiomeColors.js';
import { hash2 } from '../utils/random.js';
import { GeometryBuffer, FLAG_SWAY, FLAG_WATER, FLAG_WATER_SURFACE } from './GeometryBuffer.js';

/**
 * Greedy section mesher.
 *
 * Input is a 16³ section padded with a 1-block border (18³) of block ids and
 * packed light so faces at section edges can be culled and smoothly lit
 * without access to the world. Output is up to three meshes (opaque, cutout,
 * translucent) plus a face-connectivity mask used for occlusion culling.
 *
 * Features: hidden-face culling, greedy merging of coplanar faces with
 * identical texture/tint/light/AO, smooth lighting, ambient occlusion with
 * anisotropy-corrected triangulation, lowered water surfaces, and special
 * shapes (cross plants, torches, cacti). Pure JS — runs in Web Workers.
 */

/** Padded edge length. */
export const PADDED = 18;
const SX = 1;
const SZ = PADDED;
const SY = PADDED * PADDED;
/** Padded array size. */
export const PADDED_VOLUME = PADDED * PADDED * PADDED;

/**
 * Index into padded arrays for section-local coordinates in -1..16.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number}
 */
export function paddedIndex(x, y, z) {
  return x + 1 + (z + 1) * SZ + (y + 1) * SY;
}

const AXIS_STRIDE = [SX, SY, SZ];
const WATER_DROP = 0.125;

/** Face descriptors: normal axis d, sign s, in-plane axes ua/va. */
const FACES = [
  { face: 0, d: 0, s: 1, ua: 2, va: 1, n: [127, 0, 0] },
  { face: 1, d: 0, s: -1, ua: 2, va: 1, n: [-127, 0, 0] },
  { face: 2, d: 1, s: 1, ua: 0, va: 2, n: [0, 127, 0] },
  { face: 3, d: 1, s: -1, ua: 0, va: 2, n: [0, -127, 0] },
  { face: 4, d: 2, s: 1, ua: 0, va: 1, n: [0, 0, 127] },
  { face: 5, d: 2, s: -1, ua: 0, va: 1, n: [0, 0, -127] },
];
for (const f of FACES) {
  const eU = [0, 0, 0];
  const eV = [0, 0, 0];
  eU[f.ua] = 1;
  eV[f.va] = 1;
  const cross = [eU[1] * eV[2] - eU[2] * eV[1], eU[2] * eV[0] - eU[0] * eV[2], eU[0] * eV[1] - eU[1] * eV[0]];
  f.reverse = cross[f.d] * f.s < 0;
}

/** Corner sample directions (su, sv) in quad order. */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Texture coordinates for a vertex on a face (block units, repeating).
 * @param {number} face
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} rot quarter turns
 * @param {Float32Array|number[]} out
 */
function faceUV(face, x, y, z, rot, out) {
  let u;
  let v;
  switch (face) {
    case 0:
      u = -z; v = y; break;
    case 1:
      u = z; v = y; break;
    case 2:
      u = x; v = -z; break;
    case 3:
      u = x; v = z; break;
    case 4:
      u = x; v = y; break;
    default:
      u = -x; v = y;
  }
  switch (rot) {
    case 1:
      out[0] = v; out[1] = -u; break;
    case 2:
      out[0] = -u; out[1] = -v; break;
    case 3:
      out[0] = -v; out[1] = u; break;
    default:
      out[0] = u; out[1] = v;
  }
}

/** Face-pair bit index for the 15 unordered pairs of the 6 section faces. */
const PAIR_BIT = [];
{
  let bit = 0;
  for (let i = 0; i < 6; i++) {
    PAIR_BIT[i] = [];
    for (let j = 0; j < 6; j++) PAIR_BIT[i][j] = -1;
  }
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      PAIR_BIT[i][j] = bit;
      PAIR_BIT[j][i] = bit;
      bit++;
    }
  }
}
/** Visibility mask with every face pair connected. */
export const VISIBILITY_ALL = 0x7fff;

/**
 * Whether two faces of a section are connected in a visibility mask.
 * @param {number} mask
 * @param {number} a face 0..5
 * @param {number} b face 0..5
 * @returns {boolean}
 */
export function facesConnected(mask, a, b) {
  if (a === b) return true;
  return (mask & (1 << PAIR_BIT[a][b])) !== 0;
}

/**
 * @typedef {object} MeshResult
 * @property {import('./GeometryBuffer.js').MeshData|null} opaque
 * @property {import('./GeometryBuffer.js').MeshData|null} cutout
 * @property {import('./GeometryBuffer.js').MeshData|null} translucent
 * @property {number} visibility face connectivity mask
 */

export class ChunkMesher {
  constructor() {
    this.buffers = [new GeometryBuffer(8192), new GeometryBuffer(2048), new GeometryBuffer(2048)];
    this.maskTex = new Int32Array(256);
    this.maskSky = new Int32Array(256);
    this.maskBlk = new Int32Array(256);
    this.maskAO = new Int32Array(256);
    this.maskTint = new Int32Array(256);
    this.maskMerge = new Uint8Array(256);
    this.cornerSky = new Int32Array(4);
    this.cornerBlk = new Int32Array(4);
    this.cornerAO = new Int32Array(4);
    this.uv = new Float32Array(2);
    this.visited = new Uint8Array(4096);
    this.queue = new Int16Array(4096);
    this.fancyLeaves = true;
  }

  /**
   * Meshes one section.
   * @param {Uint8Array} blocks padded block ids (18³)
   * @param {Uint8Array} light padded packed light (18³)
   * @param {Uint8Array} climate 256 packed climate bytes of the chunk columns
   * @param {number} ox section world origin x
   * @param {number} oy section world origin y
   * @param {number} oz section world origin z
   * @param {{fancyLeaves?: boolean}} [options]
   * @returns {MeshResult}
   */
  mesh(blocks, light, climate, ox, oy, oz, options = {}) {
    this.fancyLeaves = options.fancyLeaves !== false;
    this.blocks = blocks;
    this.light = light;
    this.climate = climate;
    for (const b of this.buffers) b.reset();
    for (const f of FACES) this.greedyFace(f);
    this.specialShapes(ox, oy, oz);
    return {
      opaque: this.buffers[RenderLayer.OPAQUE].finish(),
      cutout: this.buffers[RenderLayer.CUTOUT].finish(),
      translucent: this.buffers[RenderLayer.TRANSLUCENT].finish(),
      visibility: this.computeVisibility(),
    };
  }

  /**
   * Whether the face of block `id` toward neighbour `nid` is visible.
   * @private
   */
  faceVisible(id, nid, shape) {
    const reg = blockRegistry;
    if (reg.opaque[nid]) return false;
    if (shape === Shape.LIQUID) return nid !== id && nid !== BlockIds.ice;
    if (nid === id) {
      if (reg.cullSelf[id]) return false;
      if (!this.fancyLeaves && id === BlockIds.oak_leaves) return false;
    }
    return true;
  }

  /**
   * Builds masks for every slice of one face direction and greedily merges.
   * @private
   * @param {typeof FACES[0]} F
   */
  greedyFace(F) {
    const reg = blockRegistry;
    const { d, s, ua, va, face } = F;
    const blocks = this.blocks;
    const light = this.light;
    const nStride = AXIS_STRIDE[d] * s;
    const uStride = AXIS_STRIDE[ua];
    const vStride = AXIS_STRIDE[va];
    const shapeT = reg.shape;
    const opaque = reg.opaque;
    const { maskTex, maskSky, maskBlk, maskAO, maskTint, maskMerge } = this;
    const pos = [0, 0, 0];

    for (let i = 0; i < 16; i++) {
      let any = false;
      for (let b = 0; b < 16; b++) {
        for (let a = 0; a < 16; a++) {
          const m = a + (b << 4);
          maskTex[m] = -1;
          pos[d] = i;
          pos[ua] = a;
          pos[va] = b;
          const p = pos[0] + 1 + (pos[2] + 1) * SZ + (pos[1] + 1) * SY;
          const id = blocks[p];
          if (id === 0) continue;
          const shape = shapeT[id];
          if (shape !== Shape.CUBE && shape !== Shape.LIQUID) continue;
          const q = p + nStride;
          const nid = blocks[q];
          if (!this.faceVisible(id, nid, shape)) continue;

          // Smooth light + ambient occlusion for the four corners.
          let sky = 0;
          let blk = 0;
          let ao = 0;
          let canU = 1;
          let canV = 1;
          const cs = this.cornerSky;
          const cb = this.cornerBlk;
          const ca = this.cornerAO;
          for (let c = 0; c < 4; c++) {
            const su = CORNERS[c][0];
            const sv = CORNERS[c][1];
            const i1 = q + su * uStride;
            const i2 = q + sv * vStride;
            const i3 = i1 + sv * vStride;
            const o1 = opaque[blocks[i1]];
            const o2 = opaque[blocks[i2]];
            const o3 = opaque[blocks[i3]];
            const occ = o1 && o2 ? 0 : 3 - (o1 + o2 + o3);
            const l0 = light[q];
            let ss = l0 >> 4;
            let bs = l0 & 15;
            let n = 1;
            if (!o1) {
              ss += light[i1] >> 4;
              bs += light[i1] & 15;
              n++;
            }
            if (!o2) {
              ss += light[i2] >> 4;
              bs += light[i2] & 15;
              n++;
            }
            if (!o3 && !(o1 && o2)) {
              ss += light[i3] >> 4;
              bs += light[i3] & 15;
              n++;
            }
            cs[c] = Math.round((ss * 4) / n);
            cb[c] = Math.round((bs * 4) / n);
            ca[c] = occ;
          }
          sky = cs[0] | (cs[1] << 6) | (cs[2] << 12) | (cs[3] << 18);
          blk = cb[0] | (cb[1] << 6) | (cb[2] << 12) | (cb[3] << 18);
          ao = ca[0] | (ca[1] << 2) | (ca[2] << 4) | (ca[3] << 6);
          if (cs[0] !== cs[1] || cs[3] !== cs[2] || cb[0] !== cb[1] || cb[3] !== cb[2] || ca[0] !== ca[1] || ca[3] !== ca[2]) canU = 0;
          if (cs[0] !== cs[3] || cs[1] !== cs[2] || cb[0] !== cb[3] || cb[1] !== cb[2] || ca[0] !== ca[3] || ca[1] !== ca[2]) canV = 0;

          let lowered = 0;
          if (shape === Shape.LIQUID && blocks[p + SY] !== id) lowered = 1;
          const tex = reg.faceTex[id * 6 + face];
          const rot = reg.faceRot[id * 6 + face];
          maskTex[m] = tex | (rot << 12) | (reg.layer[id] << 14) | (lowered << 16) | ((shape === Shape.LIQUID ? 1 : 0) << 17);
          maskSky[m] = sky;
          maskBlk[m] = blk;
          maskAO[m] = ao;
          const tintKind = reg.tint[id];
          maskTint[m] = tintKind ? TINT_LUT[tintKind][this.climate[pos[0] | (pos[2] << 4)]] : 0xffffff;
          maskMerge[m] = canU | (canV << 1);
          any = true;
        }
      }
      if (any) this.mergeSlice(F, i);
    }
  }

  /**
   * Greedy merge of the current mask into quads.
   * @private
   */
  mergeSlice(F, i) {
    const { maskTex, maskSky, maskBlk, maskAO, maskTint, maskMerge } = this;
    const same = (m, o) =>
      maskTex[o] === maskTex[m] && maskSky[o] === maskSky[m] && maskBlk[o] === maskBlk[m] && maskAO[o] === maskAO[m] && maskTint[o] === maskTint[m];
    for (let b = 0; b < 16; b++) {
      for (let a = 0; a < 16; ) {
        const m = a + (b << 4);
        if (maskTex[m] < 0) {
          a++;
          continue;
        }
        const merge = maskMerge[m];
        let w = 1;
        if (merge & 1) while (a + w < 16 && same(m, m + w)) w++;
        let h = 1;
        if (merge & 2) {
          outer: while (b + h < 16) {
            for (let k = 0; k < w; k++) if (!same(m, m + k + (h << 4))) break outer;
            h++;
          }
        }
        this.emitQuad(F, i, a, b, w, h, m);
        for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) maskTex[m + k + (hh << 4)] = -1;
        a += w;
      }
    }
  }

  /**
   * Emits a merged quad.
   * @private
   */
  emitQuad(F, i, a, b, w, h, m) {
    const key = this.maskTex[m];
    const tex = key & 0xfff;
    const rot = (key >> 12) & 3;
    const layer = (key >> 14) & 3;
    const lowered = (key >> 16) & 1;
    const isWater = (key >> 17) & 1;
    const sky = this.maskSky[m];
    const blk = this.maskBlk[m];
    const ao = this.maskAO[m];
    const tint = this.maskTint[m];
    const buf = this.buffers[layer];
    const { d, s, ua, va, face, n } = F;

    let plane = i + (s > 0 ? 1 : 0);
    if (lowered && face === 2) plane -= WATER_DROP;
    const u0 = a;
    const u1 = a + w;
    const v0 = b;
    let v1 = b + h;
    if (lowered && va === 1) v1 -= WATER_DROP;

    let flags = 0;
    if (isWater) flags |= FLAG_WATER;
    if (isWater && face === 2) flags |= FLAG_WATER_SURFACE;

    buf.ensure(4);
    const base = buf.vertexCount;
    const order = F.reverse ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const pos = [0, 0, 0];
    const uv = this.uv;
    for (let k = 0; k < 4; k++) {
      const c = order[k];
      pos[d] = plane;
      pos[ua] = c === 0 || c === 3 ? u0 : u1;
      pos[va] = c === 0 || c === 1 ? v0 : v1;
      faceUV(face, pos[0], pos[1], pos[2], rot, uv);
      buf.vertex(
        pos[0], pos[1], pos[2], n[0], n[1], n[2], uv[0], uv[1], tex,
        (sky >> (c * 6)) & 63, (blk >> (c * 6)) & 63, (ao >> (c * 2)) & 3, flags, tint,
      );
    }
    // Triangulate along the diagonal that best preserves the AO gradient.
    const a0 = ao & 3;
    const a1 = (ao >> 2) & 3;
    const a2 = (ao >> 4) & 3;
    const a3 = (ao >> 6) & 3;
    buf.quad(base, a0 + a2 > a1 + a3);
  }

  /**
   * Non-cube shapes: cross plants, torches and cacti.
   * @private
   */
  specialShapes(ox, oy, oz) {
    const reg = blockRegistry;
    const blocks = this.blocks;
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const p = x + 1 + (z + 1) * SZ + (y + 1) * SY;
          const id = blocks[p];
          if (id === 0) continue;
          const shape = reg.shape[id];
          if (shape === Shape.CROSS) this.crossPlant(id, p, x, y, z, ox + x, oz + z);
          else if (shape === Shape.TORCH) this.torch(id, p, x, y, z);
          else if (shape === Shape.CACTUS) this.cactus(id, p, x, y, z);
        }
      }
    }
  }

  /**
   * Two double-sided diagonal quads with a random horizontal jitter.
   * @private
   */
  crossPlant(id, p, x, y, z, wx, wz) {
    const reg = blockRegistry;
    const buf = this.buffers[RenderLayer.CUTOUT];
    const l = this.light[p];
    const sky = (l >> 4) * 4;
    const blk = (l & 15) * 4;
    const tex = reg.faceTex[id * 6];
    const tintKind = reg.tint[id];
    const tint = tintKind ? TINT_LUT[tintKind][this.climate[x | (z << 4)]] : 0xffffff;
    const hsh = hash2(0x5eed, wx, wz);
    const jx = ((hsh & 255) / 255 - 0.5) * 0.25;
    const jz = (((hsh >> 8) & 255) / 255 - 0.5) * 0.25;
    const cx = x + 0.5 + jx;
    const cz = z + 0.5 + jz;
    const r = 0.45;
    const h = id === BlockIds.tall_grass ? 0.9 : 0.8;
    const planes = [
      [cx - r, cz - r, cx + r, cz + r],
      [cx - r, cz + r, cx + r, cz - r],
    ];
    buf.ensure(16);
    for (const [x0, z0, x1, z1] of planes) {
      for (let side = 0; side < 2; side++) {
        const base = buf.vertexCount;
        const pts = side === 0
          ? [[x0, z0, 0], [x1, z1, 1], [x1, z1, 1], [x0, z0, 0]]
          : [[x1, z1, 1], [x0, z0, 0], [x0, z0, 0], [x1, z1, 1]];
        for (let k = 0; k < 4; k++) {
          const top = k >= 2;
          const [px, pz, u] = pts[k];
          buf.vertex(px, y + (top ? h : 0), pz, 0, 127, 0, u, top ? 1 : 0, tex, sky, blk, 3, top ? FLAG_SWAY : 0, tint);
        }
        buf.quad(base, false);
      }
    }
  }

  /**
   * Torch: a thin textured stick, leaning when wall-mounted.
   * @private
   */
  torch(id, p, x, y, z) {
    const reg = blockRegistry;
    const buf = this.buffers[RenderLayer.CUTOUT];
    const l = this.light[p];
    const sky = (l >> 4) * 4;
    const blk = (l & 15) * 4;
    const tex = reg.faceTex[id * 6];
    const aux = reg.aux[id];
    const dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    const [dx, dz] = dirs[aux];
    const lift = aux ? 0.1875 : 0;
    const shear = 0.4;
    const H = 0.625;
    const w0 = 7 / 16;
    const w1 = 9 / 16;
    const tf = (lx, ly, lz) => [
      x + lx - dx * 0.3125 + dx * shear * ly,
      y + ly + lift,
      z + lz - dz * 0.3125 + dz * shear * ly,
    ];
    // side faces: [normal, corners (lx, ly, lz) CCW from outside, u range]
    const sides = [
      [[127, 0, 0], [[w1, 0, w1], [w1, 0, w0], [w1, H, w0], [w1, H, w1]]],
      [[-127, 0, 0], [[w0, 0, w0], [w0, 0, w1], [w0, H, w1], [w0, H, w0]]],
      [[0, 0, 127], [[w0, 0, w1], [w1, 0, w1], [w1, H, w1], [w0, H, w1]]],
      [[0, 0, -127], [[w1, 0, w0], [w0, 0, w0], [w0, H, w0], [w1, H, w0]]],
    ];
    buf.ensure(20);
    const uvs = [[w0, 0], [w1, 0], [w1, H], [w0, H]];
    for (const [n, corners] of sides) {
      const base = buf.vertexCount;
      for (let k = 0; k < 4; k++) {
        const [px, py, pz] = tf(...corners[k]);
        buf.vertex(px, py, pz, n[0], n[1], n[2], uvs[k][0], uvs[k][1], tex, sky, blk, 3, 0, 0xffffff);
      }
      buf.quad(base, false);
    }
    // top cap (flame)
    const topCorners = [[w0, H, w1], [w1, H, w1], [w1, H, w0], [w0, H, w0]];
    const topUV = [[w0, 0.5], [w1, 0.5], [w1, H], [w0, H]];
    const base = buf.vertexCount;
    for (let k = 0; k < 4; k++) {
      const [px, py, pz] = tf(...topCorners[k]);
      buf.vertex(px, py, pz, 0, 127, 0, topUV[k][0], topUV[k][1], tex, sky, blk, 3, 0, 0xffffff);
    }
    buf.quad(base, false);
  }

  /**
   * Cactus: full-height column with sides inset by 1/16.
   * @private
   */
  cactus(id, p, x, y, z) {
    const reg = blockRegistry;
    const buf = this.buffers[RenderLayer.CUTOUT];
    const blocks = this.blocks;
    const l = this.light[p];
    const sky = (l >> 4) * 4;
    const blk = (l & 15) * 4;
    const e = 1 / 16;
    const uv = this.uv;
    const quads = [];
    quads.push([0, [[x + 1 - e, y, z + 1], [x + 1 - e, y, z], [x + 1 - e, y + 1, z], [x + 1 - e, y + 1, z + 1]], [127, 0, 0]]);
    quads.push([1, [[x + e, y, z], [x + e, y, z + 1], [x + e, y + 1, z + 1], [x + e, y + 1, z]], [-127, 0, 0]]);
    quads.push([4, [[x, y, z + 1 - e], [x + 1, y, z + 1 - e], [x + 1, y + 1, z + 1 - e], [x, y + 1, z + 1 - e]], [0, 0, 127]]);
    quads.push([5, [[x + 1, y, z + e], [x, y, z + e], [x, y + 1, z + e], [x + 1, y + 1, z + e]], [0, 0, -127]]);
    const above = blocks[p + SY];
    const below = blocks[p - SY];
    if (above !== id && !reg.opaque[above]) {
      quads.push([2, [[x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z], [x, y + 1, z]], [0, 127, 0]]);
    }
    if (below !== id && !reg.opaque[below]) {
      quads.push([3, [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]], [0, -127, 0]]);
    }
    buf.ensure(quads.length * 4);
    for (const [face, corners, n] of quads) {
      const tex = reg.faceTex[id * 6 + face];
      const base = buf.vertexCount;
      for (const [px, py, pz] of corners) {
        faceUV(face, px, py, pz, 0, uv);
        buf.vertex(px, py, pz, n[0], n[1], n[2], uv[0], uv[1], tex, sky, blk, 3, 0, 0xffffff);
      }
      buf.quad(base, false);
    }
  }

  /**
   * Flood-fills non-opaque cells to find which section faces can see each
   * other (Minecraft-style cave culling).
   * @private
   * @returns {number}
   */
  computeVisibility() {
    const opaque = blockRegistry.opaque;
    const blocks = this.blocks;
    const visited = this.visited;
    const queue = this.queue;
    let opaqueCount = 0;
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const c = x | (z << 4) | (y << 8);
          const o = opaque[blocks[x + 1 + (z + 1) * SZ + (y + 1) * SY]];
          visited[c] = o;
          opaqueCount += o;
        }
      }
    }
    if (opaqueCount === 0) return VISIBILITY_ALL;
    if (opaqueCount === 4096) return 0;
    let mask = 0;
    for (let start = 0; start < 4096; start++) {
      if (visited[start]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let faces = 0;
      while (head < tail) {
        const c = queue[head++];
        const x = c & 15;
        const z = (c >> 4) & 15;
        const y = c >> 8;
        if (x === 15) faces |= 1;
        if (x === 0) faces |= 2;
        if (y === 15) faces |= 4;
        if (y === 0) faces |= 8;
        if (z === 15) faces |= 16;
        if (z === 0) faces |= 32;
        if (x < 15 && !visited[c + 1]) { visited[c + 1] = 1; queue[tail++] = c + 1; }
        if (x > 0 && !visited[c - 1]) { visited[c - 1] = 1; queue[tail++] = c - 1; }
        if (z < 15 && !visited[c + 16]) { visited[c + 16] = 1; queue[tail++] = c + 16; }
        if (z > 0 && !visited[c - 16]) { visited[c - 16] = 1; queue[tail++] = c - 16; }
        if (y < 15 && !visited[c + 256]) { visited[c + 256] = 1; queue[tail++] = c + 256; }
        if (y > 0 && !visited[c - 256]) { visited[c - 256] = 1; queue[tail++] = c - 256; }
      }
      for (let i = 0; i < 6; i++) {
        if (!(faces & (1 << i))) continue;
        for (let j = i + 1; j < 6; j++) if (faces & (1 << j)) mask |= 1 << PAIR_BIT[i][j];
      }
      if (mask === VISIBILITY_ALL) break;
    }
    return mask;
  }
}
