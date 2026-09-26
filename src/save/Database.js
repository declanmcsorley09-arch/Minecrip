/**
 * Promise-based IndexedDB wrapper.
 *
 * Object stores:
 * - `worlds`: world metadata (seed, name, time, player...) keyed by `id`
 * - `chunks`: chunk modifications keyed by `[worldId, cx, cz]`
 * - `meta`: global key/value data (settings)
 */

const DB_NAME = 'minecrip';
const DB_VERSION = 1;

/**
 * Wraps an IDBRequest in a promise.
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class Database {
  /**
   * @param {IDBDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Opens (and upgrades) the database.
   * @param {string} [name]
   * @returns {Promise<Database>}
   */
  static open(name = DB_NAME) {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['worldId', 'cx', 'cz'] });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(new Database(req.result));
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
    });
  }

  /** @private */
  store(name, mode) {
    return this.db.transaction(name, mode).objectStore(name);
  }

  /**
   * @param {string} store
   * @param {IDBValidKey} key
   * @returns {Promise<any>}
   */
  get(store, key) {
    return promisify(this.store(store, 'readonly').get(key));
  }

  /**
   * @param {string} store
   * @param {object} value
   * @returns {Promise<IDBValidKey>}
   */
  put(store, value) {
    return promisify(this.store(store, 'readwrite').put(value));
  }

  /**
   * Writes many records in one transaction.
   * @param {string} store
   * @param {object[]} values
   * @returns {Promise<void>}
   */
  putAll(store, values) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const v of values) os.put(v);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /**
   * @param {string} store
   * @param {IDBValidKey|IDBKeyRange} key
   * @returns {Promise<void>}
   */
  delete(store, key) {
    return promisify(this.store(store, 'readwrite').delete(key));
  }

  /**
   * @param {string} store
   * @param {IDBKeyRange} [range]
   * @returns {Promise<any[]>}
   */
  getAll(store, range) {
    return promisify(this.store(store, 'readonly').getAll(range));
  }

  /**
   * @param {string} store
   * @param {IDBKeyRange} [range]
   * @returns {Promise<IDBValidKey[]>}
   */
  getAllKeys(store, range) {
    return promisify(this.store(store, 'readonly').getAllKeys(range));
  }

  /** Closes the connection. */
  close() {
    this.db.close();
  }
}

/**
 * Key range covering every chunk of a world.
 * @param {string} worldId
 * @returns {IDBKeyRange}
 */
export function worldChunkRange(worldId) {
  return IDBKeyRange.bound([worldId, -Infinity, -Infinity], [worldId, Infinity, Infinity]);
}
