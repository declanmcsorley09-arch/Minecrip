import { Shape, RenderLayer, Tint, SoundType, ToolType, Face } from './BlockShapes.js';

/**
 * Central registry of block types.
 *
 * Every block is described by a plain definition object (see
 * {@link BlockRegistry#register}). The registry fills dense typed lookup
 * tables so hot loops (meshing, lighting, physics) never touch objects.
 * Block IDs are explicit so saved worlds stay compatible when blocks are
 * added. The registry is pure JavaScript and is instantiated identically in
 * the main thread, Web Workers, and a headless server.
 */

/** Maximum number of block ids (chunk storage is Uint8). */
export const MAX_BLOCKS = 256;

const FULL_BOX = Object.freeze([0, 0, 0, 1, 1, 1]);

/**
 * @typedef {object} DropSpec
 * @property {string} item item name
 * @property {number} [min=1] minimum count
 * @property {number} [max=1] maximum count
 * @property {number} [chance=1] probability that this drop occurs
 */

/**
 * @typedef {object} BlockDefinition
 * @property {number} id stable numeric id (1..255)
 * @property {string} name unique snake_case identifier
 * @property {string} displayName human readable name
 * @property {number} hardness seconds-scale hardness, -1 = unbreakable
 * @property {number} shape one of {@link Shape}
 * @property {number} layer one of {@link RenderLayer}
 * @property {boolean} opaque occludes neighbours and blocks all light
 * @property {boolean} solid participates in collisions
 * @property {number} lightEmission emitted block light 0..15
 * @property {number} lightFilter extra light attenuation when light passes through
 * @property {object} textures per-face texture names
 * @property {number} tint one of {@link Tint}
 * @property {string} sound one of {@link SoundType}
 * @property {string} tool preferred {@link ToolType}
 * @property {boolean} requiresTool drops only when mined with the right tool
 * @property {number} harvestLevel minimum tool tier (0 wood .. 3 diamond)
 * @property {DropSpec[]|null} drops explicit drops; null means "drop itself"
 * @property {boolean} replaceable placing a block may overwrite this one
 * @property {boolean} gravity falls when unsupported (sand, gravel)
 * @property {string|null} support 'solid-below' | 'soil' | 'sand' | 'attached' | null
 * @property {number[]|null} collision local AABB [x0,y0,z0,x1,y1,z1] or null
 * @property {number[]} selection local selection AABB
 * @property {boolean} cullSelf faces between two identical blocks are hidden
 * @property {boolean} fluid block is a liquid
 * @property {string|null} itemName item obtained when picked / dropped
 * @property {boolean} hasItem appears as its own item
 * @property {string|null} interaction UI opened on use ('crafting' | 'furnace')
 * @property {string} mapColor representative colour (particles, generic textures)
 * @property {number} slipperiness ground friction factor (0.6 normal, 0.98 ice)
 * @property {string|null} placement variant resolver ('axis' | 'facing' | 'torch')
 * @property {string|null} variantOf base block name for placement variants
 * @property {object} variantData extra variant data (axis, facing, lit...)
 */

export class BlockRegistry {
  constructor() {
    /** @type {(BlockDefinition|undefined)[]} */
    this.byId = new Array(MAX_BLOCKS);
    /** @type {Map<string, BlockDefinition>} */
    this.byName = new Map();
    /** Name → id lookup, e.g. `ids.stone`. @type {Record<string, number>} */
    this.ids = Object.create(null);
    /** Texture names in layer order. @type {string[]} */
    this.textureNames = [];
    /** @type {Map<string, number>} */
    this.textureIndex = new Map();
    /** Representative colour per texture name (for generic painters). @type {Map<string,string>} */
    this.textureColors = new Map();

    this.opaque = new Uint8Array(MAX_BLOCKS);
    this.solid = new Uint8Array(MAX_BLOCKS);
    this.shape = new Uint8Array(MAX_BLOCKS);
    this.layer = new Uint8Array(MAX_BLOCKS);
    this.emission = new Uint8Array(MAX_BLOCKS);
    this.filter = new Uint8Array(MAX_BLOCKS);
    this.tint = new Uint8Array(MAX_BLOCKS);
    this.cullSelf = new Uint8Array(MAX_BLOCKS);
    this.replaceable = new Uint8Array(MAX_BLOCKS);
    this.fluid = new Uint8Array(MAX_BLOCKS);
    this.gravity = new Uint8Array(MAX_BLOCKS);
    /** Shape-specific auxiliary value (torch lean direction). */
    this.aux = new Uint8Array(MAX_BLOCKS);
    /** Texture layer per face: id * 6 + face. */
    this.faceTex = new Uint16Array(MAX_BLOCKS * 6);
    /** Texture rotation (quarter turns) per face: id * 6 + face. */
    this.faceRot = new Uint8Array(MAX_BLOCKS * 6);

    this.register({ id: 0, name: 'air', displayName: 'Air', shape: Shape.NONE, solid: false, opaque: false, hardness: 0, replaceable: true, hasItem: false, sound: SoundType.NONE, selection: null });
  }

  /**
   * Registers (or returns the index of) a texture name.
   * @param {string} name
   * @param {string} [color] fallback colour for procedural generation
   * @returns {number} texture array layer
   */
  registerTexture(name, color) {
    if (color && !this.textureColors.has(name)) this.textureColors.set(name, color);
    let idx = this.textureIndex.get(name);
    if (idx === undefined) {
      idx = this.textureNames.length;
      this.textureNames.push(name);
      this.textureIndex.set(name, idx);
    }
    return idx;
  }

  /**
   * Registers a block type. Only `id` and `name` are required; every other
   * property has a sensible default so new blocks can be added in one line.
   * @param {Partial<BlockDefinition> & {id:number, name:string}} spec
   * @returns {BlockDefinition}
   */
  register(spec) {
    const { id, name } = spec;
    if (!Number.isInteger(id) || id < 0 || id >= MAX_BLOCKS) throw new Error(`Invalid block id ${id} for ${name}`);
    if (this.byId[id]) throw new Error(`Block id ${id} already used by ${this.byId[id].name}`);
    if (this.byName.has(name)) throw new Error(`Block name ${name} already registered`);

    const shape = spec.shape ?? Shape.CUBE;
    const layer = spec.layer ?? RenderLayer.OPAQUE;
    const opaque = spec.opaque ?? (shape === Shape.CUBE && layer === RenderLayer.OPAQUE);
    const solid = spec.solid ?? shape !== Shape.NONE;
    const collision = spec.collision !== undefined ? spec.collision : solid ? FULL_BOX : null;

    /** @type {BlockDefinition} */
    const def = {
      id,
      name,
      displayName: spec.displayName ?? toDisplayName(name),
      hardness: spec.hardness ?? 1,
      shape,
      layer,
      opaque,
      solid,
      lightEmission: spec.lightEmission ?? 0,
      lightFilter: opaque ? 15 : (spec.lightFilter ?? 0),
      textures: spec.textures ?? {},
      tint: spec.tint ?? Tint.NONE,
      sound: spec.sound ?? SoundType.STONE,
      tool: spec.tool ?? ToolType.NONE,
      requiresTool: spec.requiresTool ?? false,
      harvestLevel: spec.harvestLevel ?? 0,
      drops: spec.drops ?? null,
      replaceable: spec.replaceable ?? false,
      gravity: spec.gravity ?? false,
      support: spec.support ?? null,
      collision,
      selection: spec.selection !== undefined ? spec.selection : collision ?? FULL_BOX,
      cullSelf: spec.cullSelf ?? false,
      fluid: spec.fluid ?? false,
      itemName: spec.itemName ?? spec.variantOf ?? name,
      hasItem: spec.hasItem ?? !spec.variantOf,
      interaction: spec.interaction ?? null,
      mapColor: spec.mapColor ?? '#888888',
      slipperiness: spec.slipperiness ?? 0.6,
      placement: spec.placement ?? null,
      variantOf: spec.variantOf ?? null,
      variantData: spec.variantData ?? {},
    };

    this.byId[id] = def;
    this.byName.set(name, def);
    this.ids[name] = id;

    this.opaque[id] = opaque ? 1 : 0;
    this.solid[id] = solid ? 1 : 0;
    this.shape[id] = shape;
    this.layer[id] = layer;
    this.emission[id] = def.lightEmission;
    this.filter[id] = def.lightFilter;
    this.tint[id] = def.tint;
    this.cullSelf[id] = def.cullSelf ? 1 : 0;
    this.replaceable[id] = def.replaceable ? 1 : 0;
    this.fluid[id] = def.fluid ? 1 : 0;
    this.gravity[id] = def.gravity ? 1 : 0;
    this.aux[id] = spec.aux ?? 0;

    if (shape !== Shape.NONE) this.resolveTextures(def, spec.textureRotation);
    return def;
  }

  /**
   * Expands a texture spec ({all}, {top,bottom,side}, per-face...) into the
   * per-face lookup tables.
   * @private
   * @param {BlockDefinition} def
   * @param {number[]} [rotation] optional per-face quarter turns
   */
  resolveTextures(def, rotation) {
    const t = def.textures;
    const side = t.side ?? t.all ?? def.name;
    const faces = [
      t.east ?? side,
      t.west ?? side,
      t.top ?? t.end ?? t.all ?? side,
      t.bottom ?? t.end ?? t.all ?? side,
      t.south ?? side,
      t.north ?? side,
    ];
    for (let f = 0; f < 6; f++) {
      this.faceTex[def.id * 6 + f] = this.registerTexture(faces[f], def.mapColor);
      this.faceRot[def.id * 6 + f] = rotation ? rotation[f] : 0;
    }
    def.faceTextures = faces;
  }

  /**
   * @param {number} id
   * @returns {BlockDefinition}
   */
  get(id) {
    return this.byId[id] ?? this.byId[0];
  }

  /**
   * @param {string} name
   * @returns {BlockDefinition|undefined}
   */
  getByName(name) {
    return this.byName.get(name);
  }

  /**
   * All registered definitions in id order.
   * @returns {BlockDefinition[]}
   */
  all() {
    return this.byId.filter(Boolean);
  }

  /**
   * Texture layer of a given face of a block.
   * @param {number} id
   * @param {number} face one of {@link Face}
   * @returns {number}
   */
  textureOf(id, face) {
    return this.faceTex[id * 6 + face];
  }

  /**
   * Whether a block at `id` fully hides the face of a neighbour of type `other`.
   * @param {number} id neighbour block in front of the face
   * @param {number} self block owning the face
   * @returns {boolean}
   */
  occludes(id, self) {
    if (this.opaque[id]) return true;
    return id === self && this.cullSelf[id] === 1;
  }
}

/**
 * Converts snake_case to Title Case.
 * @param {string} name
 * @returns {string}
 */
export function toDisplayName(name) {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export { Face };
