import { PixelImage, TINT_ALPHA, rgb, shade, mix, withAlpha } from './PixelImage.js';
import { SeededRandom, seedFromString } from '../../utils/random.js';

/**
 * Procedural 16×16 pixel-art painters for every block texture. All art is
 * generated at startup from deterministic random streams — no external
 * assets. Unknown texture names fall back to a noisy fill of the block's
 * map colour, so adding a block never requires new art.
 * @module renderer/textures/BlockTextures
 */

/** Toroidal distance for tileable patterns. */
function wrapDist(ax, ay, bx, by) {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (dx > 8) dx = 16 - dx;
  if (dy > 8) dy = 16 - dy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Tileable Voronoi: returns per-pixel nearest cell index and edge factor.
 * @param {SeededRandom} r
 * @param {number} count
 * @returns {{cell: Int32Array, edge: Float32Array, dist: Float32Array}}
 */
function voronoi(r, count) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([r.range(0, 16), r.range(0, 16)]);
  const cell = new Int32Array(256);
  const edge = new Float32Array(256);
  const dist = new Float32Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let best = 0;
      for (let i = 0; i < count; i++) {
        const d = wrapDist(x + 0.5, y + 0.5, pts[i][0], pts[i][1]);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = i;
        } else if (d < d2) d2 = d;
      }
      cell[y * 16 + x] = best;
      edge[y * 16 + x] = d2 - d1;
      dist[y * 16 + x] = d1;
    }
  }
  return { cell, edge, dist };
}

function noisy(img, r, base, lo = 0.88, hi = 1.12) {
  img.paint(() => shade(base, lo + r.next() * (hi - lo)));
}

function specks(img, r, color, n) {
  for (let i = 0; i < n; i++) img.set(r.int(0, 15), r.int(0, 15), color);
}

function stoneBase(img, r) {
  const base = rgb('#7d7d7d');
  noisy(img, r, base, 0.86, 1.08);
  for (let i = 0; i < 8; i++) {
    const cx = r.int(0, 15);
    const cy = r.int(0, 15);
    const len = r.int(2, 4);
    for (let k = 0; k < len; k++) img.set(cx + k, cy + (r.chance(0.3) ? 1 : 0), shade(base, 0.7 + r.next() * 0.08));
  }
  specks(img, r, shade(base, 1.15), 10);
}

function dirtBase(img, r) {
  const base = rgb('#866043');
  noisy(img, r, base, 0.85, 1.1);
  specks(img, r, rgb('#5d3f27'), 18);
  specks(img, r, rgb('#9f7a55'), 12);
  specks(img, r, rgb('#6f6f6f'), 3);
}

function planksBase(img, r) {
  const base = rgb('#a2824e');
  for (let y = 0; y < 16; y++) {
    const board = y >> 2;
    const seam = (board * 7 + 3) % 16;
    const boardTone = 0.94 + ((board * 37) % 5) * 0.03;
    for (let x = 0; x < 16; x++) {
      let f = boardTone * (0.93 + r.next() * 0.1);
      if ((y & 3) === 3) f *= 0.7;
      else if ((y & 3) === 0) f *= 1.05;
      if (x === seam && (y & 3) !== 3) f *= 0.72;
      if (r.chance(0.06)) f *= 0.85;
      img.set(x, y, shade(base, f));
    }
  }
}

function cobbleBase(img, r, base = rgb('#7f7f7f')) {
  const v = voronoi(r, 10);
  const tones = [];
  for (let i = 0; i < 10; i++) tones.push(0.78 + r.next() * 0.3);
  img.paint((x, y) => {
    const i = y * 16 + x;
    if (v.edge[i] < 0.9) return shade(base, 0.52 + r.next() * 0.08);
    const light = 1.08 - Math.min(v.dist[i], 5) * 0.05;
    return shade(base, tones[v.cell[i]] * light * (0.95 + r.next() * 0.1));
  });
}

function oreOnStone(img, r, dark, light, clusters) {
  stoneBase(img, r);
  for (let c = 0; c < clusters; c++) {
    const cx = r.int(1, 13);
    const cy = r.int(1, 13);
    const n = r.int(3, 5);
    for (let k = 0; k < n; k++) {
      const x = cx + r.int(0, 2);
      const y = cy + r.int(0, 2);
      img.set(x, y, r.chance(0.35) ? light : dark);
    }
  }
}

function metalBlock(img, r, color) {
  const base = rgb(color);
  img.paint((x, y) => {
    let f = 1 + (r.next() - 0.5) * 0.04;
    if (x === 0 || y === 0) f = 1.18;
    else if (x === 15 || y === 15) f = 0.7;
    else if (x === 1 || y === 1) f = 1.08;
    else if (x === 14 || y === 14) f = 0.82;
    if ((x + y) % 7 === 0 && x > 2 && x < 13) f *= 1.08;
    return shade(base, f);
  });
}

function flowerStem(img) {
  const stem = rgb('#3f8a2a');
  const leaf = rgb('#4fa334');
  for (let y = 8; y < 16; y++) img.set(7, y, stem);
  img.set(6, 12, leaf);
  img.set(5, 11, leaf);
  img.set(8, 13, leaf);
  img.set(9, 12, leaf);
}

function transparent(img) {
  img.data.fill(0);
}

/** Crack network shared by the destroy stages. */
let crackPixels = null;
function getCracks() {
  if (crackPixels) return crackPixels;
  const r = new SeededRandom(0xc2ac);
  const pts = [];
  const seen = new Set();
  const walkers = [];
  for (let i = 0; i < 6; i++) walkers.push({ x: 7 + r.int(-1, 1), y: 7 + r.int(-1, 1), dx: Math.cos(i), dy: Math.sin(i) });
  for (let step = 0; step < 40; step++) {
    for (const w of walkers) {
      w.dx += (r.next() - 0.5) * 0.9;
      w.dy += (r.next() - 0.5) * 0.9;
      const len = Math.hypot(w.dx, w.dy) || 1;
      w.x += w.dx / len;
      w.y += w.dy / len;
      const px = Math.round(w.x);
      const py = Math.round(w.y);
      if (px < 0 || px > 15 || py < 0 || py > 15) continue;
      const key = py * 16 + px;
      if (!seen.has(key)) {
        seen.add(key);
        pts.push([px, py]);
      }
    }
  }
  crackPixels = pts;
  return pts;
}

/** @type {Record<string, (img: PixelImage, r: SeededRandom) => void>} */
const PAINTERS = {
  stone: stoneBase,
  dirt: dirtBase,
  grass_top(img, r) {
    img.paint(() => {
      const v = 178 + r.next() * 58;
      return [v, v, v, TINT_ALPHA];
    });
    for (let i = 0; i < 20; i++) {
      const v = 140 + r.next() * 20;
      img.set(r.int(0, 15), r.int(0, 15), [v, v, v, TINT_ALPHA]);
    }
  },
  grass_side(img, r) {
    dirtBase(img, r);
    for (let x = 0; x < 16; x++) {
      const depth = 3 + (r.chance(0.5) ? 1 : 0) + (r.chance(0.2) ? 1 : 0);
      for (let y = 0; y < depth; y++) {
        const v = y === depth - 1 ? 150 : 178 + r.next() * 55;
        img.set(x, y, [v, v, v, TINT_ALPHA]);
      }
    }
  },
  grass_snow_side(img, r) {
    dirtBase(img, r);
    const snow = rgb('#eef7f7');
    for (let x = 0; x < 16; x++) {
      const depth = 3 + (r.chance(0.5) ? 1 : 0) + (r.chance(0.25) ? 1 : 0);
      for (let y = 0; y < depth; y++) img.set(x, y, shade(snow, y === depth - 1 ? 0.86 : 0.95 + r.next() * 0.07));
    }
  },
  snow(img, r) {
    noisy(img, r, rgb('#f2f9f9'), 0.93, 1.02);
    specks(img, r, rgb('#d8e6ea'), 10);
  },
  cobblestone(img, r) {
    cobbleBase(img, r);
  },
  mossy_cobblestone(img, r) {
    cobbleBase(img, r);
    const moss = rgb('#5a8a33');
    const blobs = [];
    for (let i = 0; i < 5; i++) blobs.push([r.range(0, 16), r.range(0, 16), r.range(2, 4.5)]);
    img.paint((x, y) => {
      for (const [bx, by, br] of blobs) {
        if (wrapDist(x, y, bx, by) < br + r.next() * 0.8) return shade(moss, 0.8 + r.next() * 0.35);
      }
      return null;
    });
  },
  planks: planksBase,
  log_side(img, r) {
    const base = rgb('#6b5233');
    const cols = [];
    for (let x = 0; x < 16; x++) cols.push(0.82 + r.next() * 0.3);
    img.paint((x, y) => {
      let f = cols[x] * (0.95 + r.next() * 0.08);
      if ((x === 3 || x === 9 || x === 13) && r.chance(0.8)) f *= 0.72;
      return shade(base, f);
    });
  },
  log_top(img, r) {
    const wood = rgb('#b8945f');
    const bark = rgb('#6b5233');
    img.paint((x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.6) return shade(bark, 0.85 + r.next() * 0.25);
      const ring = Math.floor(d + r.next() * 0.3) % 2 === 0 ? 1 : 0.86;
      return shade(wood, ring * (0.95 + r.next() * 0.08));
    });
  },
  leaves(img, r) {
    img.paint(() => {
      if (r.chance(0.2)) return [0, 0, 0, 0];
      const v = 110 + r.next() * 100;
      return [v, v, v, TINT_ALPHA];
    });
  },
  glass(img, r) {
    transparent(img);
    const frame = [219, 239, 245, 255];
    const inner = [180, 214, 226, 255];
    for (let i = 0; i < 16; i++) {
      img.set(i, 0, frame);
      img.set(i, 15, inner);
      img.set(0, i, frame);
      img.set(15, i, inner);
    }
    const glare = [245, 252, 255, 255];
    for (const [x, y] of [[3, 2], [2, 3], [4, 2], [2, 4], [3, 3], [11, 9], [10, 10], [9, 11], [12, 12], [4, 5], [5, 4]]) img.set(x, y, glare);
    if (r.chance(1)) img.set(13, 3, glare);
  },
  water(img, r) {
    img.paint((x, y) => {
      const wave = Math.sin((x + y * 0.5) * 0.8 + Math.sin(y * 0.9) * 1.5) * 0.5 + 0.5;
      const v = 0.8 + wave * 0.14 + r.next() * 0.04;
      return [230 * v, 238 * v, 250 * v, 175];
    });
  },
  ice(img, r) {
    const base = rgb('#a5c8f7');
    img.paint(() => withAlpha(shade(base, 0.95 + r.next() * 0.08), 200));
    const crack = withAlpha(rgb('#e3f0ff'), 220);
    let x = r.int(2, 5);
    let y = 0;
    while (y < 16) {
      img.set(x, y, crack);
      y++;
      x += r.int(-1, 1);
    }
    for (let i = 0; i < 6; i++) img.set(9 + i, 10 - (i >> 1), crack);
  },
  sand(img, r) {
    noisy(img, r, rgb('#dbd3a0'), 0.92, 1.06);
    specks(img, r, rgb('#c4b98a'), 16);
    specks(img, r, rgb('#ebe5bd'), 10);
  },
  gravel(img, r) {
    const v = voronoi(r, 16);
    const palette = ['#8a8480', '#6f6a66', '#9c9590', '#7c6f66', '#a9a39e', '#5f5a57'].map(rgb);
    const tones = [];
    for (let i = 0; i < 16; i++) tones.push(palette[r.int(0, palette.length - 1)]);
    img.paint((x, y) => {
      const i = y * 16 + x;
      if (v.edge[i] < 0.7) return shade(tones[v.cell[i]], 0.62);
      return shade(tones[v.cell[i]], 0.92 + r.next() * 0.14);
    });
  },
  bedrock(img, r) {
    const palette = ['#5a5a5a', '#3a3a3a', '#7a7a7a', '#262626', '#4a4a4a'].map(rgb);
    const coarse = [];
    for (let i = 0; i < 16; i++) coarse.push(r.int(0, palette.length - 1));
    img.paint((x, y) => {
      const c = r.chance(0.55) ? coarse[(y >> 2) * 4 + (x >> 2)] : r.int(0, palette.length - 1);
      return shade(palette[c], 0.9 + r.next() * 0.2);
    });
  },
  coal_ore(img, r) {
    oreOnStone(img, r, rgb('#262626'), rgb('#474747'), 5);
  },
  iron_ore(img, r) {
    oreOnStone(img, r, rgb('#c9a184'), rgb('#e6c8b0'), 4);
  },
  gold_ore(img, r) {
    oreOnStone(img, r, rgb('#e2b93a'), rgb('#fff27a'), 4);
  },
  diamond_ore(img, r) {
    oreOnStone(img, r, rgb('#35c6cf'), rgb('#b8fbff'), 4);
  },
  sandstone_side(img, r) {
    const base = rgb('#d8cb96');
    img.paint((x, y) => {
      let f = 0.95 + r.next() * 0.07;
      if (y < 3) f *= 1.06;
      if (y === 3 || y === 11) f *= 0.84;
      if (y > 12) f *= 0.93;
      return shade(base, f);
    });
  },
  sandstone_top(img, r) {
    noisy(img, r, rgb('#dbcf9d'), 0.95, 1.05);
  },
  sandstone_bottom(img, r) {
    noisy(img, r, rgb('#d3c690'), 0.9, 1.05);
    specks(img, r, rgb('#b8ab78'), 14);
  },
  crafting_table_top(img, r) {
    planksBase(img, r);
    const dark = rgb('#5a4326');
    for (let i = 0; i < 16; i++) {
      img.set(i, 0, dark);
      img.set(i, 15, dark);
      img.set(0, i, dark);
      img.set(15, i, dark);
    }
    for (let i = 2; i < 14; i++) {
      img.set(i, 5, shade(dark, 1.2));
      img.set(i, 10, shade(dark, 1.2));
      img.set(5, i, shade(dark, 1.2));
      img.set(10, i, shade(dark, 1.2));
    }
  },
  crafting_table_side(img, r) {
    planksBase(img, r);
    const dark = rgb('#4a3620');
    for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) img.set(x, y, shade(dark, 1.1 + (y === 2 ? -0.2 : 0)));
    // saw
    const blade = rgb('#c7c7c7');
    for (let x = 3; x < 9; x++) img.set(x, 6, blade);
    for (let x = 3; x < 9; x += 2) img.set(x, 7, shade(blade, 0.8));
    img.set(9, 6, rgb('#6b4a2a'));
    img.set(10, 6, rgb('#6b4a2a'));
    // hammer
    const handle = rgb('#7a5530');
    for (let y = 9; y < 14; y++) img.set(11, y, handle);
    img.set(10, 9, blade);
    img.set(12, 9, blade);
    img.set(10, 10, shade(blade, 0.8));
    img.set(12, 10, shade(blade, 0.8));
  },
  crafting_table_front(img, r) {
    PAINTERS.crafting_table_side(img, r);
    const metal = rgb('#b0b0b0');
    for (let y = 9; y < 14; y++) {
      img.set(4, y, metal);
      img.set(6, y, metal);
    }
    img.set(5, 9, shade(metal, 0.8));
  },
  furnace_side(img, r) {
    const base = rgb('#737373');
    img.paint((x, y) => {
      let f = 0.92 + r.next() * 0.1;
      if (y === 0 || x === 0) f *= 1.12;
      if (y === 15 || x === 15) f *= 0.8;
      return shade(base, f);
    });
  },
  furnace_top(img, r) {
    PAINTERS.furnace_side(img, r);
    const inner = rgb('#6a6a6a');
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) img.set(x, y, shade(inner, 0.95 + r.next() * 0.1));
  },
  furnace_front(img, r) {
    PAINTERS.furnace_side(img, r);
    const hole = rgb('#1c1c1c');
    for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) img.set(x, y, hole);
    for (let x = 4; x < 12; x++) img.set(x, 7, rgb('#5a5a5a'));
    for (let x = 5; x < 12; x += 2) img.set(x, 12, rgb('#3a3a3a'));
    for (let x = 3; x < 13; x++) img.set(x, 3, rgb('#5f5f5f'));
  },
  furnace_front_lit(img, r) {
    PAINTERS.furnace_front(img, r);
    const flames = ['#ffe36b', '#ffb42a', '#ff7a1a', '#d24a10'].map(rgb);
    for (let y = 9; y < 14; y++) {
      for (let x = 4; x < 12; x++) {
        const h = 13 - y;
        if (r.next() < 0.85 - h * 0.12) img.set(x, y, flames[Math.min(3, h + r.int(0, 1))]);
      }
    }
  },
  torch(img) {
    transparent(img);
    const stick = rgb('#6b4c2a');
    const stickLight = rgb('#8f6a3c');
    for (let y = 8; y < 16; y++) {
      img.set(7, y, stickLight);
      img.set(8, y, stick);
    }
    img.set(7, 7, rgb('#ffe066'));
    img.set(8, 7, rgb('#ffb62e'));
    img.set(7, 6, rgb('#fff4b0'));
    img.set(8, 6, rgb('#ffd24a'));
  },
  tall_grass(img, r) {
    transparent(img);
    for (let blade = 0; blade < 9; blade++) {
      let x = r.int(1, 14);
      const h = r.int(6, 14);
      for (let k = 0; k < h; k++) {
        const y = 15 - k;
        const v = 150 + k * 6 + r.next() * 20;
        img.set(x, y, [v, v, v, TINT_ALPHA]);
        if (k > 3 && r.chance(0.25)) x += r.chance(0.5) ? 1 : -1;
        if (x < 0 || x > 15) break;
      }
    }
  },
  dandelion(img) {
    transparent(img);
    flowerStem(img);
    const petal = rgb('#f7d42b');
    for (let y = 4; y < 9; y++) for (let x = 5; x < 11; x++) if ((x - 7.5) ** 2 + (y - 6) ** 2 < 5.5) img.set(x, y, petal);
    img.set(7, 6, rgb('#e8a317'));
    img.set(8, 6, rgb('#e8a317'));
  },
  poppy(img) {
    transparent(img);
    flowerStem(img);
    const petal = rgb('#d42525');
    const dark = rgb('#a51616');
    for (let y = 3; y < 9; y++) for (let x = 4; x < 12; x++) if ((x - 7.5) ** 2 + (y - 5.5) ** 2 < 8) img.set(x, y, (x + y) % 3 === 0 ? dark : petal);
    img.set(7, 5, rgb('#2b1a12'));
    img.set(8, 6, rgb('#2b1a12'));
  },
  bluebell(img) {
    transparent(img);
    flowerStem(img);
    const petal = rgb('#4b6ae0');
    const light = rgb('#7f97f0');
    const bells = [[6, 4], [9, 6], [6, 7]];
    for (const [bx, by] of bells) {
      img.set(bx, by, light);
      img.set(bx + 1, by, petal);
      img.set(bx - 1, by + 1, petal);
      img.set(bx, by + 1, petal);
      img.set(bx + 1, by + 1, petal);
      img.set(bx + 2, by + 1, shade(petal, 0.8));
    }
  },
  cactus_side(img, r) {
    const base = rgb('#2f8a36');
    img.paint((x) => {
      let f = 0.92 + r.next() * 0.1;
      if (x === 1 || x === 5 || x === 10 || x === 14) f *= 0.72;
      return shade(base, f);
    });
    for (let i = 0; i < 10; i++) img.set(r.int(0, 15), r.int(0, 15), rgb('#dfe8b8'));
  },
  cactus_top(img, r) {
    const base = rgb('#3a9a42');
    img.paint((x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      let f = 0.95 + r.next() * 0.08;
      if (Math.floor(d) === 5) f *= 0.75;
      if (d < 2) f *= 1.1;
      return shade(base, f);
    });
  },
  cactus_bottom(img, r) {
    PAINTERS.cactus_top(img, r);
  },
  dead_bush(img, r) {
    transparent(img);
    const twig = rgb('#94703e');
    const dark = rgb('#6b4f2a');
    for (let b = 0; b < 5; b++) {
      let x = 7.5;
      let y = 15;
      const dir = (b - 2) * 0.45;
      for (let k = 0; k < 9; k++) {
        img.set(Math.round(x), Math.round(y), k % 3 === 0 ? dark : twig);
        x += dir + (r.next() - 0.5) * 0.6;
        y -= 1;
        if (x < 0 || x > 15) break;
      }
    }
  },
  clay(img, r) {
    noisy(img, r, rgb('#9fa4b1'), 0.94, 1.05);
    specks(img, r, rgb('#b3b8c4'), 12);
  },
  wool(img, r) {
    const base = rgb('#e9ecec');
    img.paint((x, y) => {
      let f = 0.93 + r.next() * 0.07;
      if ((x + y * 2) % 5 === 0) f *= 0.92;
      return shade(base, f);
    });
  },
  glow_crystal(img, r) {
    const v = voronoi(r, 9);
    const core = rgb('#fff4c2');
    const mid = rgb('#ffd98a');
    const edge = rgb('#c9862e');
    img.paint((x, y) => {
      const i = y * 16 + x;
      if (v.edge[i] < 0.8) return shade(edge, 0.9 + r.next() * 0.2);
      return v.dist[i] < 1.6 ? core : shade(mid, 0.92 + r.next() * 0.12);
    });
  },
  stone_bricks(img, r) {
    const base = rgb('#7a7a7a');
    img.paint((x, y) => {
      const row = y >> 3;
      const ly = y & 7;
      const seam = row === 0 ? 15 : 7;
      if (ly === 7 || x === seam) return shade(base, 0.6);
      let f = 0.93 + r.next() * 0.1;
      if (ly === 0 || x === (seam + 1) % 16) f *= 1.12;
      if (ly === 6 || x === (seam + 15) % 16) f *= 0.85;
      return shade(base, f);
    });
  },
  bricks(img, r) {
    const brick = rgb('#96503e');
    const mortar = rgb('#b5ada2');
    const tones = [];
    for (let i = 0; i < 16; i++) tones.push(0.85 + r.next() * 0.25);
    img.paint((x, y) => {
      const row = y >> 2;
      const offset = row % 2 === 0 ? 0 : 4;
      if ((y & 3) === 3 || (x + offset) % 8 === 7) return shade(mortar, 0.9 + r.next() * 0.1);
      const id = row * 2 + (((x + offset) >> 3) & 1);
      return shade(brick, tones[id % 16] * (0.93 + r.next() * 0.1));
    });
  },
  iron_block(img, r) {
    metalBlock(img, r, '#d8d8d8');
  },
  gold_block(img, r) {
    metalBlock(img, r, '#f5d74a');
  },
  diamond_block(img, r) {
    metalBlock(img, r, '#62e3dc');
  },
};

/**
 * Paints a texture by name.
 * @param {string} name texture name
 * @param {string} [fallbackColor] map colour for unknown names
 * @returns {PixelImage}
 */
export function paintBlockTexture(name, fallbackColor = '#888888') {
  const img = new PixelImage(16);
  const r = new SeededRandom(seedFromString(`tex:${name}`));
  const destroy = /^destroy_(\d)$/.exec(name);
  if (destroy) {
    transparent(img);
    const stage = Number(destroy[1]);
    const cracks = getCracks();
    const count = Math.floor((cracks.length * (stage + 1)) / 10);
    for (let i = 0; i < count; i++) img.set(cracks[i][0], cracks[i][1], [20, 20, 20, 255]);
    return img;
  }
  const painter = PAINTERS[name];
  if (painter) painter(img, r);
  else noisy(img, r, rgb(fallbackColor), 0.88, 1.1);
  return img;
}

/**
 * Average opaque colour of a texture (used for particles and icons).
 * @param {PixelImage} img
 * @returns {number[]}
 */
export function averageColor(img) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    r += img.data[i];
    g += img.data[i + 1];
    b += img.data[i + 2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}

export { mix };
