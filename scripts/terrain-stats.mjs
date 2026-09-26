import { TerrainGenerator } from '../src/terrain/TerrainGenerator.js';
import { BIOMES } from '../src/terrain/Biomes.js';
import { BlockIds, blockRegistry } from '../src/blocks/index.js';
import { SEA_LEVEL } from '../src/world/constants.js';

const seed = Number(process.argv[2] ?? 12345);
const gen = new TerrainGenerator(seed);
const t0 = performance.now();
const N = 12;
const biomeCounts = new Map();
const blockCounts = new Map();
let heights = [];
let caveAir = 0, underground = 0;
for (let cx = -N; cx < N; cx += 3) for (let cz = -N; cz < N; cz += 3) {
  const { blocks, heightmap, biomes } = gen.generate(cx * 7, cz * 7);
  for (let i = 0; i < 256; i++) {
    biomeCounts.set(BIOMES[biomes[i]].name, (biomeCounts.get(BIOMES[biomes[i]].name) ?? 0) + 1);
    heights.push(heightmap[i]);
    const h = gen.column(i & 15, i >> 4).height;
    for (let y = 5; y < h - 8; y++) { underground++; if (blocks[i | (y << 8)] === 0) caveAir++; }
  }
  for (let i = 0; i < blocks.length; i++) blockCounts.set(blocks[i], (blockCounts.get(blocks[i]) ?? 0) + 1);
}
const chunks = Math.ceil(2 * N / 3) ** 2;
const t1 = performance.now();
console.log(`generated ${chunks} chunks in ${(t1 - t0).toFixed(0)} ms (${((t1 - t0) / chunks).toFixed(1)} ms/chunk)`);
const total = [...biomeCounts.values()].reduce((a, b) => a + b, 0);
console.log('biomes:', [...biomeCounts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / total).toFixed(1)}%`).join(', '));
heights.sort((a, b) => a - b);
console.log('height p5/p50/p95/max', heights[Math.floor(heights.length * 0.05)], heights[Math.floor(heights.length / 2)], heights[Math.floor(heights.length * 0.95)], heights[heights.length - 1]);
console.log(`cave air fraction underground: ${(100 * caveAir / underground).toFixed(2)}%`);
const names = (id) => blockRegistry.get(id).name;
console.log('blocks:', [...blockCounts].filter(([k]) => k !== 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${names(k)}:${v}`).join(' '));
// determinism
const a = new TerrainGenerator(seed).generate(3, -7).blocks;
new TerrainGenerator(seed).generate(4, -7);
const g2 = new TerrainGenerator(seed); g2.generate(100, 100);
const b = g2.generate(3, -7).blocks;
let same = true; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
console.log('deterministic:', same);
console.log('spawn', gen.findSpawn());
