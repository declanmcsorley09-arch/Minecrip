import * as THREE from 'three';
import { skinBox, skinRects, part } from './SkinBox.js';
import { PixelImage, rgb, shade } from '../textures/PixelImage.js';
import { SeededRandom, seedFromString } from '../../utils/random.js';
import { createEntityMaterial } from '../EntityMaterial.js';

/**
 * Blocky mob models with procedurally painted pixel-art skins. Each model
 * is described by a list of parts (box size in pixels, pivot, offset,
 * parent) plus paint functions; skins are packed automatically.
 * @module renderer/models/MobModels
 */

const SKIN = 64;

/**
 * @typedef {object} PartSpec
 * @property {string} name
 * @property {number[]} box [w, h, d] in pixels
 * @property {number[]} pivot pivot position in pixels (relative to parent pivot)
 * @property {number[]} offset box centre relative to the pivot
 * @property {string} [parent]
 * @property {number} [inflate]
 * @property {string} color base colour
 * @property {(img: PixelImage, rects: Record<string, number[]>, r: SeededRandom) => void} [paint]
 */

/** Fills a rectangle with a noisy colour. */
function fillRect(img, rect, color, r, variance = 0.12) {
  const [x, y, w, h] = rect;
  const base = rgb(color);
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) img.set(px, py, shade(base, 1 - variance / 2 + r.next() * variance));
  }
}

/** Sets pixels relative to a face rect. */
function dot(img, rect, fx, fy, color) {
  const [x, y, w, h] = rect;
  if (fx < 0 || fy < 0 || fx >= w || fy >= h) return;
  img.set(x + fx, y + fy, rgb(color));
}

/** Draws two eyes on a face. */
function eyes(img, front, y, inset, pupil, white = '#ffffff') {
  const w = front[2];
  dot(img, front, inset, y, white);
  dot(img, front, inset + 1, y, pupil);
  dot(img, front, w - 1 - inset, y, white);
  dot(img, front, w - 2 - inset, y, pupil);
}

/** @type {Record<string, PartSpec[]>} */
const MODELS = {
  pig: [
    { name: 'body', box: [10, 8, 14], pivot: [0, 10, 0], offset: [0, 0, 0], color: '#f0a5a2' },
    {
      name: 'head', box: [8, 8, 8], pivot: [0, 11, -6], offset: [0, 1, -4], color: '#f0a5a2',
      paint: (img, rc) => eyes(img, rc.front, 3, 1, '#1a1a1a'),
    },
    {
      name: 'snout', parent: 'head', box: [4, 3, 1], pivot: [0, 0, 0], offset: [0, -0.5, -8.5], color: '#e7878a',
      paint: (img, rc) => {
        dot(img, rc.front, 0, 1, '#8a4a4a');
        dot(img, rc.front, 3, 1, '#8a4a4a');
      },
    },
    { name: 'legFR', box: [4, 6, 4], pivot: [-3, 6, -5], offset: [0, -3, 0], color: '#e8999a' },
    { name: 'legFL', box: [4, 6, 4], pivot: [3, 6, -5], offset: [0, -3, 0], color: '#e8999a' },
    { name: 'legBR', box: [4, 6, 4], pivot: [-3, 6, 5], offset: [0, -3, 0], color: '#e8999a' },
    { name: 'legBL', box: [4, 6, 4], pivot: [3, 6, 5], offset: [0, -3, 0], color: '#e8999a' },
  ],
  cow: [
    {
      name: 'body', box: [12, 10, 18], pivot: [0, 17, 0], offset: [0, 0, 0], color: '#3f2b1f',
      paint: (img, rc, r) => {
        for (const face of Object.values(rc)) {
          for (let i = 0; i < 3; i++) {
            const cx = face[0] + r.int(0, face[2] - 1);
            const cy = face[1] + r.int(0, face[3] - 1);
            const rad = r.range(1.5, 3.5);
            for (let y = face[1]; y < face[1] + face[3]; y++) {
              for (let x = face[0]; x < face[0] + face[2]; x++) {
                if ((x - cx) ** 2 + (y - cy) ** 2 < rad * rad) img.set(x, y, shade(rgb('#e9e6e0'), 0.95 + r.next() * 0.08));
              }
            }
          }
        }
      },
    },
    {
      name: 'head', box: [8, 8, 6], pivot: [0, 20, -9], offset: [0, 0, -3], color: '#3f2b1f',
      paint: (img, rc, r) => {
        fillRect(img, [rc.front[0] + 1, rc.front[1] + 4, 6, 4], '#d9c1a8', r);
        eyes(img, rc.front, 2, 0, '#111111');
        dot(img, rc.front, 2, 6, '#5a3a2a');
        dot(img, rc.front, 5, 6, '#5a3a2a');
      },
    },
    { name: 'hornL', parent: 'head', box: [1, 3, 1], pivot: [0, 0, 0], offset: [4.5, 4.5, -4], color: '#d0cfc4' },
    { name: 'hornR', parent: 'head', box: [1, 3, 1], pivot: [0, 0, 0], offset: [-4.5, 4.5, -4], color: '#d0cfc4' },
    { name: 'legFR', box: [4, 12, 4], pivot: [-4, 12, -6.5], offset: [0, -6, 0], color: '#3a281c' },
    { name: 'legFL', box: [4, 12, 4], pivot: [4, 12, -6.5], offset: [0, -6, 0], color: '#3a281c' },
    { name: 'legBR', box: [4, 12, 4], pivot: [-4, 12, 6.5], offset: [0, -6, 0], color: '#3a281c' },
    { name: 'legBL', box: [4, 12, 4], pivot: [4, 12, 6.5], offset: [0, -6, 0], color: '#3a281c' },
  ],
  sheep: [
    { name: 'body', box: [8, 8, 14], pivot: [0, 16, 0], offset: [0, 0, 0], color: '#d6bf9f' },
    { name: 'wool', parent: 'body', box: [8, 8, 14], pivot: [0, 0, 0], offset: [0, 0, 0], inflate: 1.8, color: '#ededed' },
    {
      name: 'head', box: [6, 6, 8], pivot: [0, 18, -7], offset: [0, 1, -4], color: '#d6bf9f',
      paint: (img, rc) => eyes(img, rc.front, 2, 0, '#222222'),
    },
    { name: 'headWool', parent: 'head', box: [6, 4, 6], pivot: [0, 0, 0], offset: [0, 3, -3], inflate: 0.6, color: '#ededed' },
    { name: 'legFR', box: [4, 12, 4], pivot: [-3, 12, -5], offset: [0, -6, 0], color: '#d6bf9f' },
    { name: 'legFL', box: [4, 12, 4], pivot: [3, 12, -5], offset: [0, -6, 0], color: '#d6bf9f' },
    { name: 'legBR', box: [4, 12, 4], pivot: [-3, 12, 5], offset: [0, -6, 0], color: '#d6bf9f' },
    { name: 'legBL', box: [4, 12, 4], pivot: [3, 12, 5], offset: [0, -6, 0], color: '#d6bf9f' },
  ],
  zombie: [
    {
      name: 'head', box: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], color: '#4f8a3c',
      paint: (img, rc) => {
        dot(img, rc.front, 1, 4, '#1b2a16');
        dot(img, rc.front, 2, 4, '#1b2a16');
        dot(img, rc.front, 5, 4, '#1b2a16');
        dot(img, rc.front, 6, 4, '#1b2a16');
        for (let x = 2; x < 6; x++) dot(img, rc.front, x, 6, '#2e4f24');
      },
    },
    { name: 'body', box: [8, 12, 4], pivot: [0, 18, 0], offset: [0, 0, 0], color: '#2d8b93' },
    { name: 'armR', box: [4, 12, 4], pivot: [-6, 22, 0], offset: [0, -4, 0], color: '#4f8a3c' },
    { name: 'armL', box: [4, 12, 4], pivot: [6, 22, 0], offset: [0, -4, 0], color: '#4f8a3c' },
    { name: 'legR', box: [4, 12, 4], pivot: [-2, 12, 0], offset: [0, -6, 0], color: '#3b3c90' },
    { name: 'legL', box: [4, 12, 4], pivot: [2, 12, 0], offset: [0, -6, 0], color: '#3b3c90' },
  ],
  skeleton: [
    {
      name: 'head', box: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], color: '#c9c9c4',
      paint: (img, rc) => {
        for (const [x, y] of [[1, 3], [2, 3], [1, 4], [2, 4], [5, 3], [6, 3], [5, 4], [6, 4]]) dot(img, rc.front, x, y, '#1a1a1a');
        dot(img, rc.front, 3, 5, '#3a3a3a');
        dot(img, rc.front, 4, 5, '#3a3a3a');
        for (let x = 1; x < 7; x += 2) dot(img, rc.front, x, 6, '#2a2a2a');
      },
    },
    {
      name: 'body', box: [8, 12, 4], pivot: [0, 18, 0], offset: [0, 0, 0], color: '#bdbdb8',
      paint: (img, rc) => {
        for (let y = 2; y < 10; y += 2) for (let x = 1; x < 7; x++) dot(img, rc.front, x, y, '#4a4a48');
        for (let y = 2; y < 10; y += 2) for (let x = 1; x < 7; x++) dot(img, rc.back, x, y, '#4a4a48');
      },
    },
    { name: 'armR', box: [2, 12, 2], pivot: [-5, 22, 0], offset: [0, -4, 0], color: '#c9c9c4' },
    { name: 'armL', box: [2, 12, 2], pivot: [5, 22, 0], offset: [0, -4, 0], color: '#c9c9c4' },
    { name: 'bow', parent: 'armR', box: [1, 10, 1], pivot: [0, 0, 0], offset: [0, -9, -2], color: '#7a5530' },
    { name: 'legR', box: [2, 12, 2], pivot: [-2, 12, 0], offset: [0, -6, 0], color: '#c9c9c4' },
    { name: 'legL', box: [2, 12, 2], pivot: [2, 12, 0], offset: [0, -6, 0], color: '#c9c9c4' },
  ],
};

/**
 * Packs part nets into the skin with a simple shelf packer.
 * @param {PartSpec[]} parts
 * @returns {number[][]} [u, v] per part
 */
function packSkin(parts) {
  let x = 0;
  let y = 0;
  let rowH = 0;
  return parts.map((p) => {
    const [w, h, d] = p.box;
    const netW = Math.ceil(2 * d + 2 * w);
    const netH = Math.ceil(d + h);
    if (x + netW > SKIN) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const uv = [x, y];
    x += netW;
    rowH = Math.max(rowH, netH);
    return uv;
  });
}

/**
 * Cached per-type template (geometries + skin texture).
 */
class ModelTemplate {
  /**
   * @param {string} type
   */
  constructor(type) {
    const parts = MODELS[type];
    this.parts = parts;
    const uvs = packSkin(parts);
    const img = new PixelImage(SKIN);
    const r = new SeededRandom(seedFromString(`skin:${type}`));
    this.geometries = parts.map((p, i) => {
      const [w, h, d] = p.box;
      const [u, v] = uvs[i];
      const rects = skinRects(Math.ceil(w), Math.ceil(h), Math.ceil(d), u, v);
      for (const rect of Object.values(rects)) fillRect(img, rect, p.color, r);
      if (p.paint) p.paint(img, rects, r);
      return skinBox(w, h, d, u, v, SKIN, SKIN, p.inflate ?? 0);
    });
    const canvas = document.createElement('canvas');
    canvas.width = SKIN;
    canvas.height = SKIN;
    const ctx = canvas.getContext('2d');
    const data = ctx.createImageData(SKIN, SKIN);
    data.data.set(img.data);
    ctx.putImageData(data, 0, 0);
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
  }
}

const templates = new Map();

/**
 * @typedef {object} MobModel
 * @property {THREE.Group} root
 * @property {Record<string, THREE.Group>} parts pivot groups by name
 * @property {THREE.MeshLambertMaterial} material per-instance voxel-lit material
 */

/**
 * Builds a new instance of a mob model.
 * @param {string} type
 * @returns {MobModel}
 */
export function createMobModel(type) {
  let t = templates.get(type);
  if (!t) {
    t = new ModelTemplate(type);
    templates.set(type, t);
  }
  const material = createEntityMaterial({ map: t.texture });
  const root = new THREE.Group();
  const parts = {};
  t.parts.forEach((p, i) => {
    const g = part(t.geometries[i], material, p.pivot, p.offset);
    parts[p.name] = g;
    (p.parent ? parts[p.parent] : root).add(g);
  });
  return { root, parts, material };
}

/** Whether a model exists for an entity type. */
export function hasMobModel(type) {
  return type in MODELS;
}

/** Releases every cached template. */
export function disposeMobTemplates() {
  for (const t of templates.values()) {
    t.texture.dispose();
    for (const g of t.geometries) g.dispose();
  }
  templates.clear();
}
