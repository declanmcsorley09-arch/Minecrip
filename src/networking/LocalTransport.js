import { Transport } from './Transport.js';

/**
 * In-process transport connecting a client to an integrated server.
 * Messages are delivered by reference (they must be treated as immutable).
 * An optional artificial latency makes it possible to exercise client-side
 * prediction and entity interpolation exactly as over a real network.
 */
export class LocalTransport extends Transport {
  /**
   * @param {number} [latencyMs=0] one-way delivery delay
   */
  constructor(latencyMs = 0) {
    super();
    /** @type {LocalTransport|null} */
    this.peer = null;
    this.latencyMs = latencyMs;
    /** @type {{at:number, msg:object}[]} */
    this.delayed = [];
  }

  /** @override */
  send(msg) {
    if (this.closed || !this.peer || this.peer.closed) return;
    if (this.latencyMs > 0) this.peer.delayed.push({ at: performance.now() + this.latencyMs, msg });
    else this.peer.inbox.push(msg);
  }

  /** @override */
  receive() {
    if (this.delayed.length > 0) {
      const now = performance.now();
      let i = 0;
      while (i < this.delayed.length && this.delayed[i].at <= now) this.inbox.push(this.delayed[i++].msg);
      if (i > 0) this.delayed.splice(0, i);
    }
    return super.receive();
  }

  /** @override */
  close() {
    super.close();
    if (this.peer && !this.peer.closed) this.peer.close();
  }
}

/**
 * Creates two connected transports.
 * @param {number} [latencyMs=0]
 * @returns {[LocalTransport, LocalTransport]} [clientSide, serverSide]
 */
export function createLocalTransportPair(latencyMs = 0) {
  const a = new LocalTransport(latencyMs);
  const b = new LocalTransport(latencyMs);
  a.peer = b;
  b.peer = a;
  return [a, b];
}
