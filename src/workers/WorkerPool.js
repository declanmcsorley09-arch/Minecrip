/**
 * Fixed-size pool of chunk workers with per-worker in-flight limits.
 * Callers are expected to keep their own priority queues and submit only
 * while {@link WorkerPool#hasCapacity} is true, which lets priorities adapt
 * every frame as the player moves.
 */
export class WorkerPool {
  /**
   * @param {() => Worker} factory creates a worker
   * @param {number} size number of workers
   * @param {number} [maxInFlight=3] jobs queued per worker
   */
  constructor(factory, size, maxInFlight = 3) {
    this.maxInFlight = maxInFlight;
    this.nextId = 1;
    /** @type {Map<number, (data: any) => void>} */
    this.callbacks = new Map();
    this.workers = [];
    for (let i = 0; i < size; i++) {
      const worker = factory();
      const slot = { worker, inFlight: 0 };
      worker.onmessage = (e) => this.onMessage(slot, e.data);
      worker.onerror = (e) => {
        console.error('Chunk worker error', e.message ?? e);
      };
      this.workers.push(slot);
    }
  }

  /** @private */
  onMessage(slot, data) {
    slot.inFlight--;
    const cb = this.callbacks.get(data.id);
    this.callbacks.delete(data.id);
    if (cb) cb(data);
  }

  /**
   * Sends a message to every worker (e.g. initialisation).
   * @param {object} msg
   */
  broadcast(msg) {
    for (const slot of this.workers) slot.worker.postMessage(msg);
  }

  /**
   * Total jobs currently executing or queued in workers.
   * @returns {number}
   */
  get inFlight() {
    let n = 0;
    for (const slot of this.workers) n += slot.inFlight;
    return n;
  }

  /**
   * Whether another job can be submitted without over-queueing.
   * @returns {boolean}
   */
  hasCapacity() {
    for (const slot of this.workers) if (slot.inFlight < this.maxInFlight) return true;
    return false;
  }

  /**
   * Submits a job to the least busy worker.
   * @param {object} msg message (an `id` field is assigned)
   * @param {Transferable[]} transfer buffers to transfer
   * @param {(data: any) => void} callback invoked with the worker's reply
   * @returns {number} job id
   */
  submit(msg, transfer, callback) {
    let best = this.workers[0];
    for (const slot of this.workers) if (slot.inFlight < best.inFlight) best = slot;
    const id = this.nextId++;
    msg.id = id;
    this.callbacks.set(id, callback);
    best.inFlight++;
    best.worker.postMessage(msg, transfer);
    return id;
  }

  /** Terminates all workers and drops pending callbacks. */
  dispose() {
    for (const slot of this.workers) slot.worker.terminate();
    this.workers.length = 0;
    this.callbacks.clear();
  }
}
