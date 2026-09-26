import { Transport } from './Transport.js';
import { encodeMessage, decodeMessage } from './Protocol.js';

/**
 * Client transport for a dedicated server over WebSocket. Messages sent
 * before the socket opens are queued and flushed on connect.
 */
export class WebSocketTransport extends Transport {
  /**
   * @param {string} url ws:// or wss:// endpoint
   */
  constructor(url) {
    super();
    this.url = url;
    /** @type {object[]} */
    this.outbox = [];
    this.open = false;
    /** @type {((err: Event) => void)|null} */
    this.onError = null;
    this.socket = new WebSocket(url);
    this.socket.onopen = () => {
      this.open = true;
      for (const msg of this.outbox) this.socket.send(encodeMessage(msg));
      this.outbox.length = 0;
    };
    this.socket.onmessage = (event) => {
      const msg = decodeMessage(event.data);
      if (msg) this.inbox.push(msg);
    };
    this.socket.onerror = (event) => {
      if (this.onError) this.onError(event);
    };
    this.socket.onclose = () => super.close();
  }

  /** @override */
  send(msg) {
    if (this.closed) return;
    if (this.open) this.socket.send(encodeMessage(msg));
    else this.outbox.push(msg);
  }

  /** @override */
  close() {
    if (this.closed) return;
    this.socket.close();
    super.close();
  }
}
