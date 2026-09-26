# Minecrip

A voxel sandbox game for the browser, built with Three.js, WebGL2 and Vite. It takes its inspiration from Minecraft, but every texture, model, sound and piece of music is generated procedurally at startup. No external assets are used.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm test           # unit tests (node:test)
npm run e2e        # headless-browser end-to-end test (needs the dev server running)
```

## Features

**World**
- Infinite worlds made of 16×16×256 chunks. Chunks stream in and out around the player, with generation, lighting and meshing done in Web Workers.
- Seeded procedural terrain. The same seed always produces the same world. Biomes: plains, forest, desert, mountains, hills, valleys, rivers, beaches, oceans, deep oceans, and snowy variants of several of these. Biome colours and heights blend smoothly at borders.
- Oak trees, large oaks, pines, boulders, flowers, tall grass, cacti and dead bushes.
- 3D-noise caves (cheese caves and tunnels), with coal, iron, gold and diamond ores at depth-dependent frequencies. Bedrock floor, sea level at y = 63.
- Sunlight and block light (torches, glow crystals, lit furnaces) spread with an incremental flood fill. Editing a block only relights and rebuilds the chunks it affects.
- Sand and gravel fall when unsupported. Torches and plants break when the block holding them is removed.
- Day/night cycle, moon phases, and rain, thunder and snow with smooth transitions.

**Rendering**
- Greedy meshing, with smooth lighting and ambient occlusion baked into vertex colours.
- Face culling, frustum culling, and cave/occlusion culling using a per-section visibility graph.
- Separate opaque, cutout (leaves, plants) and translucent (water, glass) passes. Translucent geometry is sorted back to front.
- Directional sun/moon shadow maps, including shadows cast by cutout foliage.
- Procedural sky with sunrise/sunset glow, stars, sun and moon discs, drifting 3D clouds and distance fog.
- Animated, transparent water with Fresnel sky reflection and underwater fog.
- Rain and snow particles, block-break particles and a first-person held item.

**Gameplay**
- First-person controller: walk, sprint, sneak (which stops you walking off edges), jump, swim, fall damage, air control, and step-up. Creative mode adds flight.
- Survival and creative game modes, with health, drowning, death and respawn.
- Block breaking takes time according to hardness and tool, and shows crack stages. Blocks drop items, and placement is validated.
- 9-slot hotbar and 27-slot inventory, with stacking, drag and drop, drag-to-distribute, shift-click and number-key swaps. Creative mode has an item palette.
- 2×2 and 3×3 shaped crafting, furnace smelting with fuel, and wood, stone, iron and diamond tools with durability.
- Mobs: sheep, cows and pigs (passive), and zombies and skeletons (hostile, spawning at night and in the dark). They use A* pathfinding, have health, knockback and drops, and skeletons shoot arrows.
- Chat and commands.

**Engine**
- Worlds are saved to IndexedDB. Only player edits are stored as per-chunk diffs; unmodified terrain is regenerated from the seed. Saves include furnaces, animals and dropped items, the player's position and inventory, time, weather and game rules. The game autosaves, and you can keep multiple worlds.
- All audio is synthesised: footsteps and dig/place sounds for each material, jumps, hurt sounds, mob voices, wind, water, rain and thunder ambience, and generative background music. Sounds are positional, muffled underwater, and have separate volume sliders.
- Settings for render distance, FOV, mouse sensitivity, render scale, shadows, clouds, max FPS, view bobbing, occlusion culling, volumes and key bindings.
- An F3 debug overlay shows FPS, position, chunk, biome, seed, memory, chunk and mesh counts, and a per-system frame profiler.

## Controls

| Action | Default |
| --- | --- |
| Move | W A S D |
| Jump / swim up / fly up | Space (double-tap to toggle flight in creative) |
| Sneak / fly down | Left Shift |
| Sprint | Left Ctrl, or double-tap W |
| Break / attack | Left mouse |
| Place / use / eat | Right mouse |
| Pick block | Middle mouse |
| Hotbar | 1–9, mouse wheel |
| Inventory | E |
| Drop item | Q (Ctrl+Q drops the stack) |
| Chat / command | T and / |
| Debug overlay | F3 |
| Hide HUD | F1 |
| Fullscreen | F11 |
| Pause | Esc |

All keys can be rebound in Options → Keys.

## Commands

```
/time set <day|noon|sunset|night|midnight|sunrise|ticks>   /time speed <multiplier>
/weather <clear|rain|thunder>        /gamemode <survival|creative>
/tp <x> <y> <z>                      /give <item> [count]
/summon <sheep|cow|pig|zombie|skeleton>
/kill   /seed   /spawnpoint
/rule <peaceful|mobSpawning|daylightCycle|weatherCycle|keepInventory> <true|false>
```

## Architecture

```
src/
  core/        App (menus, session lifecycle), Game (one play session), GameLoop
  blocks/      BlockRegistry + block definitions, shapes, placement rules
  items/       ItemRegistry, tools and tiers, mining speed and drops
  world/       Chunk, World, ChunkStreamer, LightEngine, ChunkLighting, DayNightCycle, Weather
  terrain/     TerrainGenerator, Climate, Biomes, CaveCarver, Features (trees, rocks)
  workers/     chunkWorker (generate / relight / mesh), WorkerPool
  renderer/    Renderer, ChunkMesher (greedy + AO + smooth light), ChunkRenderer,
               OcclusionCuller, sky/clouds/weather/particles, entity models, textures
  physics/     AABB, swept collision, PhysicsBody, voxel raycast
  player/      input, Player state, PlayerController, camera, block interaction
  entities/    Entity/LivingEntity/Mob, mobs, AI goals, A* pathfinder, spawner
  inventory/   ItemStack, Inventory, slot actions, crafting grid
  crafting/    recipe registry, recipes, furnace
  networking/  Protocol, transports, GameServer (authoritative), GameClient, commands
  save/        IndexedDB wrapper, WorldStorage (chunk diffs), WorldList
  audio/       Web Audio engine, synthesiser, sound library, music, ambience
  ui/          DOM screens (menus, settings, inventories), HUD
  settings/    persisted settings and key bindings
  utils/       noise, seeded RNG, math, pools, queues, LRU, profiler
```

### Client/server split

Even in single-player, the game runs as a client and a server that talk only through protocol messages:

- `GameServer` is authoritative for block edits, entities and AI, item pickup, damage and death, furnaces, time and weather, commands, and spawning. It ticks at 20 TPS.
- `GameClient` predicts the local player's movement and block edits, which the server then acknowledges or corrects. It interpolates other entities from snapshots, rendering them 100 ms in the past.
- Messages go through a `Transport`. `LocalTransport` connects client and server in the same page and shares the `World` instance to save memory. `WebSocketTransport` is a client transport for a remote server. The protocol is plain JSON-serialisable objects (`networking/Protocol.js`), so a dedicated Node server can run `GameServer` with a WebSocket transport, plus a `World` fed by `TerrainGenerator`.

Inventory and crafting clicks are currently handled on the client and synced to the server. A dedicated server should validate these clicks, using the same `SlotActions` functions the client uses.

### Chunk pipeline

1. `ChunkStreamer` requests missing chunks nearest-first. A worker generates the terrain, applies saved edits, and computes lighting within the chunk.
2. The main thread integrates finished chunks within a per-frame time budget. `LightEngine` merges light across chunk borders and marks the affected 16³ sections dirty.
3. `ChunkRenderer` sends dirty sections, each with a one-block border (18³), to the mesh workers. The workers return geometry for the opaque, cutout and translucent layers, plus a visibility graph for the section. Geometry buffers are pooled and reused.
4. Each frame, sections are frustum-culled and then occlusion-culled with a BFS from the camera section over the visibility graphs.
5. Chunks that go out of range are saved if modified. Their block data is kept in an LRU cache, so revisiting skips regeneration.

### Adding a block

Register it in `src/blocks/definitions.js`:

```js
r.register({ id: 52, name: 'marble', hardness: 1.5, tool: P, requiresTool: true, mapColor: '#e8e4dc' });
```

Then add a painter with the same name to `PAINTERS` in `renderer/textures/BlockTextures.js`. Without one, the block gets a generic noise texture in its `mapColor`. For per-face textures, use `textures: { top, bottom, side }`.

Other properties include `opaque`, `solid`, `lightEmission`, `lightFilter`, `shape` (`Shape.CUBE`, `CROSS`, `TORCH`, `LIQUID`, `CACTUS`), `layer`, `tint`, `sound`, `drops`, `gravity`, `support` and `replaceable`. Meshing, lighting, physics, mining, icons, the creative palette and saving all read from the registry, so nothing else needs to change. Items and recipes work the same way, in `items/definitions.js` and `crafting/recipes.js`.

## Testing

- `npm test` runs 36 unit tests. They cover noise, RNG and data structures; terrain determinism; lighting (incremental results match a full recompute); meshing; collision; inventory, slot actions and crafting; and the client/server flow (handshake, falling and death, zombie AI, pathfinding, entity persistence).
- `npm run e2e` drives the real game in headless Chromium, using SwiftShader WebGL. It creates a world, walks and jumps, mines and places blocks, uses the creative and survival inventories, crafts with the mouse, places and uses a crafting table, smelts in a furnace, checks the night and mobs, saves and quits, then reloads the world and checks that everything persisted. The test fails on any console error or warning, and it writes screenshots to `screenshots/`.
- `node scripts/perf.mjs` flies through a world at render distance 8 and prints the frame profiler. `node scripts/terrain-stats.mjs [seed]` prints biome and block statistics and checks that generation is deterministic.
