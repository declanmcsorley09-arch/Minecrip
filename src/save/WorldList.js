import { worldChunkRange } from './Database.js';
import { seedFromString, randomSeed } from '../utils/random.js';

/**
 * Management of the saved worlds list (create, list, rename, delete).
 */
export class WorldList {
  /**
   * @param {import('./Database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * All worlds, most recently played first.
   * @returns {Promise<object[]>}
   */
  async list() {
    const worlds = await this.db.getAll('worlds');
    return worlds.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
  }

  /**
   * Creates a new world record.
   * @param {object} opts
   * @param {string} opts.name
   * @param {string} [opts.seed] text or numeric seed; random when empty
   * @param {'survival'|'creative'} [opts.gameMode]
   * @returns {Promise<object>}
   */
  async create({ name, seed, gameMode = 'survival' }) {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `w${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const seedText = seed && String(seed).trim() !== '' ? String(seed).trim() : String(randomSeed());
    const world = {
      id,
      name: (name && name.trim()) || 'New World',
      seed: seedFromString(seedText),
      seedText,
      gameMode,
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      time: 1000,
      weather: null,
      player: null,
    };
    await this.db.put('worlds', world);
    return world;
  }

  /**
   * @param {string} id
   * @returns {Promise<object|undefined>}
   */
  get(id) {
    return this.db.get('worlds', id);
  }

  /**
   * @param {string} id
   * @param {string} name
   */
  async rename(id, name) {
    const w = await this.db.get('worlds', id);
    if (!w) return;
    w.name = name.trim() || w.name;
    await this.db.put('worlds', w);
  }

  /**
   * Deletes a world and all its chunk data.
   * @param {string} id
   */
  async delete(id) {
    await this.db.delete('chunks', worldChunkRange(id));
    await this.db.delete('worlds', id);
  }
}

/**
 * Settings persistence adapter backed by the `meta` store.
 * @param {import('./Database.js').Database} db
 * @returns {{load: () => Promise<object|null>, save: (data: object) => Promise<void>}}
 */
export function settingsAdapter(db) {
  return {
    async load() {
      const rec = await db.get('meta', 'settings');
      return rec ? rec.value : null;
    },
    async save(data) {
      await db.put('meta', { key: 'settings', value: data });
    },
  };
}

/**
 * In-memory world list used when IndexedDB is unavailable (e.g. some
 * private browsing modes). Worlds last for the page session only.
 */
export class MemoryWorldList {
  constructor() {
    /** @type {Map<string, object>} */
    this.worlds = new Map();
  }

  /** @returns {Promise<object[]>} */
  async list() {
    return [...this.worlds.values()].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
  }

  /**
   * @param {{name:string, seed?:string, gameMode?:string}} opts
   * @returns {Promise<object>}
   */
  async create({ name, seed, gameMode = 'survival' }) {
    const id = `mem${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const seedText = seed && String(seed).trim() !== '' ? String(seed).trim() : String(randomSeed());
    const world = { id, name: (name && name.trim()) || 'New World', seed: seedFromString(seedText), seedText, gameMode, createdAt: Date.now(), lastPlayed: Date.now(), time: 1000, weather: null, player: null };
    this.worlds.set(id, world);
    return world;
  }

  /** @param {string} id */
  async get(id) {
    return this.worlds.get(id);
  }

  /** @param {string} id */
  async delete(id) {
    this.worlds.delete(id);
  }
}
