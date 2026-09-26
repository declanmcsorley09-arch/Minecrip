import * as THREE from 'three';

/**
 * Box geometry helpers for blocky entity models. Each box maps its six
 * faces onto a "skin" texture using a fixed net layout:
 *
 *   row 1 (height d):  [  d  ][ top w ][ bottom w ]
 *   row 2 (height h):  [left d][front w][right d][back w]
 *
 * starting at pixel (u, v). Dimensions are in pixels (1/16 block).
 */

/**
 * Pixel rectangles of each face of a box in the skin net.
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @param {number} u
 * @param {number} v
 * @returns {Record<string, number[]>} face → [x, y, width, height]
 */
export function skinRects(w, h, d, u, v) {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    left: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    right: [u + d + w, v + d, d, h],
    back: [u + 2 * d + w, v + d, w, h],
  };
}

/**
 * Creates a box mesh geometry with skin UVs. The model faces -Z, so the
 * "front" region is mapped onto the -Z face.
 * @param {number} w width (x) in pixels
 * @param {number} h height (y)
 * @param {number} d depth (z)
 * @param {number} u skin x offset
 * @param {number} v skin y offset
 * @param {number} texW skin width
 * @param {number} texH skin height
 * @param {number} [inflate=0] extra size in pixels (e.g. wool layer)
 * @returns {THREE.BoxGeometry}
 */
export function skinBox(w, h, d, u, v, texW, texH, inflate = 0) {
  const s = 1 / 16;
  const geo = new THREE.BoxGeometry((w + inflate * 2) * s, (h + inflate * 2) * s, (d + inflate * 2) * s);
  const r = skinRects(w, h, d, u, v);
  // Three.js BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z.
  // The model faces -Z, so its right side is +X and its back is +Z.
  const order = [r.right, r.left, r.top, r.bottom, r.back, r.front];
  const uv = geo.getAttribute('uv');
  for (let f = 0; f < 6; f++) {
    const [rx, ry, rw, rh] = order[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const fu = uv.getX(i);
      const fv = uv.getY(i);
      uv.setXY(i, (rx + fu * rw) / texW, 1 - (ry + (1 - fv) * rh) / texH);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * A limb/part: a pivot group with a box mesh offset from the pivot.
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material} material
 * @param {number[]} pivot pivot position in pixels [x, y, z]
 * @param {number[]} offset box centre relative to the pivot in pixels
 * @returns {THREE.Group}
 */
export function part(geometry, material, pivot, offset) {
  const g = new THREE.Group();
  g.position.set(pivot[0] / 16, pivot[1] / 16, pivot[2] / 16);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(offset[0] / 16, offset[1] / 16, offset[2] / 16);
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}
