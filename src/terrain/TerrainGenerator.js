import { blockRegistry, BlockIds } from '../blocks/index.js';
import { CHUNK_VOLUME, CHUNK_HEIGHT, SEA_LEVEL, LAYER_AREA } from '../world/constants.js';
import { SeededRandom, hash2, hash3, hashToUnit, mix32 } from '../utils/random.js';
import { Climate, createColumnSample } from './Climate.js';
import { CaveCarver } from './CaveCarver.js';
import { BIOMES, Biome } from './Biomes.js';
import { packClimate } from './BiomeColors.js';
import { FEATURE_RADIUS, oakTree, largeOakTree, pineTree, boulder } from './Features.js';

/**
 * Deterministic chunk generator. Given the same seed and chunk coordinates
 * it always produces the same blocks, independent of generation order, so
 * worlds are reproducible and chunks can be generated in parallel workers.
 *
 * Pipeline: climate/height sampling → terrain fill → caves → ores →
 * features (trees, boulders) → ground plants → heightmap.
 */

const B = BlockIds;
/** Column samples extend one block beyond the feature radius (for slopes). */
const PAD = FEATURE_RADIUS + 1;
const SPAN = 16 + PAD * 2;

/** Ore and underground pocket distribution. */
const ORES = [
  { id: B.dirt, veins: 7, min: 12, max: 24, minY: 5, maxY: 120 },
  { id: B.gravel, veins: 5, min: 10, max: 20, minY: 5, maxY: 110 },
  { id: B.coal_ore, veins: 18, min: 5, max: 14, minY: 5, maxY: 132 },
  { id: B.iron_ore, veins: 14, min: 4, max: 9, minY: 5, maxY: 66 },
  { id: B.gold_ore, veins: 3, min: 4, max: 8, minY: 5, maxY: 32 },
  { id: B.diamond_ore, veins: 1, min: 3, max: 8, minY: 5, maxY: 16 },
];

const FLOWERS = [B.dandelion, B.poppy, B.bluebell];

/**
 * @typedef {object} GeneratedChunk
 * @property {Uint8Array} blocks
 * @property {Uint8Array} heightmap
 * @property {Uint8Array} biomes
 * @property {Uint8Array} climate
 */

export class TerrainGenerator {
  /**
   * @param {number} seed
   */
  constructor(seed) {
    this.seed = seed >>> 0;
    this.climate = new Climate(this.seed);
    this.caves = new CaveCarver(this.seed);
    this.columns = Array.from({ length: SPAN * SPAN }, createColumnSample);
    this.rng = new SeededRandom(0);
    this.sample = createColumnSample();
  }

  /**
   * Column sample relative to the current chunk origin (-PAD..15+PAD).
   * @param {number} lx
   * @param {number} lz
   * @returns {import('./Climate.js').ColumnSample}
   */
  column(lx, lz) {
    return this.columns[(lx + PAD) * SPAN + (lz + PAD)];
  }

  /**
   * Samples the climate of a single world column (used for spawn search,
   * biome display, weather).
   * @param {number} x
   * @param {number} z
   * @returns {import('./Climate.js').ColumnSample}
   */
  sampleColumn(x, z) {
    return this.climate.sample(x, z, createColumnSample());
  }

  /**
   * Whether caves may carve at height y in a column whose surface is h.
   * Prevents breaching sea floors and river beds.
   * @param {number} y
   * @param {number} h
   * @returns {boolean}
   */
  carvable(y, h) {
    if (y < 5 || y > h) return false;
    if (h <= SEA_LEVEL + 2 && y > h - 7) return false;
    return true;
  }

  /**
   * Surface materials for a column.
   * @private
   * @param {number} lx
   * @param {number} lz
   * @returns {{top:number, filler:number, depth:number, sandstone:boolean}}
   */
  surfaceOf(lx, lz) {
    const col = this.column(lx, lz);
    const h = col.height;
    const biome = BIOMES[col.biome];
    const slope = Math.max(
      Math.abs(this.column(lx + 1, lz).height - this.column(lx - 1, lz).height),
      Math.abs(this.column(lx, lz + 1).height - this.column(lx, lz - 1).height),
    );
    const n = col.surfaceNoise;
    let top = biome.top;
    let filler = biome.filler;
    let depth = biome.fillerDepth + Math.round(n);
    let sandstone = filler === B.sand;

    if (h < SEA_LEVEL) {
      top = biome.underwater;
      if (h > SEA_LEVEL - 7 && n > 0.55 && top === B.sand) top = B.clay;
      else if (n < -0.55) top = B.gravel;
      filler = top === B.clay ? B.dirt : top;
      sandstone = false;
    } else if (col.biome === Biome.MOUNTAINS.id) {
      const snowLine = 122 + n * 7;
      if (h > snowLine) {
        top = B.snow_block;
        filler = slope > 3 ? B.stone : B.dirt;
        depth = 2;
      } else if (slope > 3 || h > snowLine - 12) {
        top = n < -0.5 ? B.gravel : B.stone;
        filler = B.stone;
      }
    } else if (slope > 4 && top !== B.sand) {
      top = B.stone;
      filler = B.stone;
    } else if ((biome.top === B.snowy_grass_block) && h > 108 + n * 5) {
      top = B.snow_block;
    }
    return { top, filler, depth: Math.max(1, depth), sandstone };
  }

  /**
   * Generates a chunk.
   * @param {number} cx
   * @param {number} cz
   * @param {Uint8Array} [blocks] optional output buffer
   * @returns {GeneratedChunk}
   */
  generate(cx, cz, blocks = new Uint8Array(CHUNK_VOLUME)) {
    blocks.fill(0);
    const x0 = cx * 16;
    const z0 = cz * 16;
    for (let i = 0; i < SPAN; i++) {
      for (let k = 0; k < SPAN; k++) {
        this.climate.sample(x0 - PAD + i, z0 - PAD + k, this.columns[i * SPAN + k]);
      }
    }

    const maxH = this.fillTerrain(blocks, x0, z0);
    this.carveCaves(blocks, cx, cz, maxH);
    this.placeOres(blocks, cx, cz);
    this.placeFeatures(blocks, x0, z0);
    this.placePlants(blocks, x0, z0);

    const heightmap = new Uint8Array(LAYER_AREA);
    const biomes = new Uint8Array(LAYER_AREA);
    const climate = new Uint8Array(LAYER_AREA);
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const col = lx | (lz << 4);
        let y = CHUNK_HEIGHT - 1;
        while (y > 0 && blocks[col | (y << 8)] === 0) y--;
        heightmap[col] = y + 1;
        const s = this.column(lx, lz);
        biomes[col] = s.biome;
        climate[col] = packClimate(s.temperature, s.humidity);
      }
    }
    return { blocks, heightmap, biomes, climate };
  }

  /**
   * Stone, surface layers, water and bedrock.
   * @private
   * @returns {number} highest terrain y in the chunk
   */
  fillTerrain(blocks, x0, z0) {
    let maxH = 0;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const col = this.column(lx, lz);
        const h = col.height;
        if (h > maxH) maxH = h;
        const biome = BIOMES[col.biome];
        const { top, filler, depth, sandstone } = this.surfaceOf(lx, lz);
        const frozen = biome.frozen || col.temperature < -0.5;
        const base = lx | (lz << 4);
        const wx = x0 + lx;
        const wz = z0 + lz;
        const topY = Math.max(h, SEA_LEVEL);
        for (let y = 0; y <= topY; y++) {
          let id;
          if (y === 0) id = B.bedrock;
          else if (y <= 3 && hashToUnit(hash3(this.seed, wx, y, wz)) < (4 - y) * 0.24) id = B.bedrock;
          else if (y < h - depth - (sandstone ? 3 : 0)) id = B.stone;
          else if (y < h - depth) id = B.sandstone;
          else if (y < h) id = filler;
          else if (y === h) id = top;
          else if (y === SEA_LEVEL && frozen) id = B.ice;
          else id = B.water;
          blocks[base | (y << 8)] = id;
        }
      }
    }
    return maxH;
  }

  /**
   * Carves 3D noise caves.
   * @private
   */
  carveCaves(blocks, cx, cz, maxH) {
    const caves = this.caves;
    caves.prepare(cx, cz, maxH);
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const h = this.column(lx, lz).height;
        const base = lx | (lz << 4);
        for (let y = 5; y <= h; y++) {
          if (!this.carvable(y, h)) continue;
          if (caves.sample(lx, y, lz) >= 0) continue;
          const idx = base | (y << 8);
          const id = blocks[idx];
          if (id === B.water || id === B.bedrock || id === B.ice) continue;
          blocks[idx] = 0;
        }
      }
    }
  }

  /**
   * Ore veins as short random walks replacing stone.
   * @private
   */
  placeOres(blocks, cx, cz) {
    const rng = this.rng;
    rng.setSeed(hash2(this.seed ^ 0x0e5a17, cx, cz));
    for (const ore of ORES) {
      for (let v = 0; v < ore.veins; v++) {
        let x = rng.int(0, 15);
        let y = rng.int(ore.minY, ore.maxY);
        let z = rng.int(0, 15);
        const size = rng.int(ore.min, ore.max);
        for (let i = 0; i < size; i++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < CHUNK_HEIGHT) {
            const idx = x | (z << 4) | (y << 8);
            if (blocks[idx] === B.stone) blocks[idx] = ore.id;
          }
          const axis = rng.int(0, 2);
          const dir = rng.chance(0.5) ? 1 : -1;
          if (axis === 0) x += dir;
          else if (axis === 1) y += dir;
          else z += dir;
        }
      }
    }
  }

  /**
   * Whether a tree/boulder may stand on the column at local (lx, lz).
   * @private
   */
  isGrassyGround(lx, lz, wx, wz) {
    const col = this.column(lx, lz);
    const h = col.height;
    if (h < SEA_LEVEL || col.river > 0.3) return false;
    const { top } = this.surfaceOf(lx, lz);
    if (top !== B.grass_block && top !== B.snowy_grass_block) return false;
    if (this.carvable(h, h) && this.caves.densityAt(wx, h, wz) < 0) return false;
    if (this.carvable(h - 1, h) && this.caves.densityAt(wx, h - 1, wz) < 0) return false;
    return true;
  }

  /**
   * Trees and boulders, including those rooted in neighbouring chunks whose
   * blocks reach into this one.
   * @private
   */
  placeFeatures(blocks, x0, z0) {
    const reg = blockRegistry;
    const place = (wx, wy, wz, id, force) => {
      const lx = wx - x0;
      const lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy <= 0 || wy >= CHUNK_HEIGHT) return;
      const idx = lx | (lz << 4) | (wy << 8);
      const cur = blocks[idx];
      if (force) {
        if (cur !== B.bedrock) blocks[idx] = id;
      } else if (cur === 0 || (reg.replaceable[cur] && !reg.fluid[cur])) {
        blocks[idx] = id;
      }
    };
    const R = FEATURE_RADIUS;
    const rng = this.rng;

    const scatter = (cell, salt, chanceOf, build) => {
      const minX = x0 - R;
      const maxX = x0 + 15 + R;
      const minZ = z0 - R;
      const maxZ = z0 + 15 + R;
      for (let gz = Math.floor(minZ / cell); gz <= Math.floor(maxZ / cell); gz++) {
        for (let gx = Math.floor(minX / cell); gx <= Math.floor(maxX / cell); gx++) {
          const h = hash2(this.seed ^ salt, gx, gz);
          const px = gx * cell + (h % cell);
          const pz = gz * cell + ((h >>> 8) % cell);
          if (px < minX || px > maxX || pz < minZ || pz > maxZ) continue;
          const col = this.column(px - x0, pz - z0);
          if (hashToUnit(mix32(h ^ 0x68e31da4)) >= chanceOf(BIOMES[col.biome])) continue;
          if (!this.isGrassyGround(px - x0, pz - z0, px, pz)) continue;
          rng.setSeed(h);
          build(px, col.height, pz, BIOMES[col.biome]);
        }
      }
    };

    scatter(5, 0x7ee5, (b) => b.treeChance, (x, y, z, biome) => {
      let type = biome.treeType;
      if (type === 'mixed') type = rng.chance(0.25) ? 'large' : 'oak';
      else if (type === 'oak' && rng.chance(0.06)) type = 'large';
      if (type === 'pine') pineTree(place, x, y, z, rng);
      else if (type === 'large') largeOakTree(place, x, y, z, rng);
      else oakTree(place, x, y, z, rng);
    });
    scatter(12, 0xb01d, (b) => b.rocks, (x, y, z) => boulder(place, x, y, z, rng));
  }

  /**
   * Single-block vegetation: grass, flowers, cacti, dead bushes.
   * @private
   */
  placePlants(blocks, x0, z0) {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const col = this.column(lx, lz);
        const h = col.height;
        if (h + 3 >= CHUNK_HEIGHT) continue;
        const base = lx | (lz << 4);
        const ground = blocks[base | (h << 8)];
        if (blocks[base | ((h + 1) << 8)] !== 0) continue;
        const wx = x0 + lx;
        const wz = z0 + lz;
        const biome = BIOMES[col.biome];
        const r = hashToUnit(hash2(this.seed ^ 0x9a55, wx, wz));
        if (ground === B.grass_block) {
          if (r < biome.flowers) {
            const patch = hash2(this.seed ^ 0xf10e, wx >> 3, wz >> 3);
            blocks[base | ((h + 1) << 8)] = FLOWERS[patch % FLOWERS.length];
          } else if (r < biome.flowers + biome.grass) {
            blocks[base | ((h + 1) << 8)] = B.tall_grass;
          }
        } else if (ground === B.sand && h >= SEA_LEVEL) {
          if (r < biome.cactus && (wx & 1) === 0 && (wz & 1) === 0) {
            const height = 1 + (hash2(this.seed ^ 0xcac7, wx, wz) % 3);
            for (let i = 1; i <= height; i++) blocks[base | ((h + i) << 8)] = B.cactus;
          } else if (r < biome.cactus + biome.deadBush) {
            blocks[base | ((h + 1) << 8)] = B.dead_bush;
          }
        }
      }
    }
  }

  /**
   * Finds a dry, grassy spawn column near the origin.
   * @returns {{x:number, y:number, z:number}}
   */
  findSpawn() {
    const s = this.sample;
    for (let radius = 0; radius < 2048; radius += 16) {
      const steps = Math.max(1, Math.floor((radius * Math.PI * 2) / 16));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * radius);
        const z = Math.round(Math.sin(a) * radius);
        this.climate.sample(x, z, s);
        const b = s.biome;
        if (s.height > SEA_LEVEL + 1 && s.height < 100 && (b === Biome.PLAINS.id || b === Biome.FOREST.id || b === Biome.VALLEY.id || b === Biome.HILLS.id)) {
          return { x: x + 0.5, y: s.height + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: 100, z: 0.5 };
  }
}
