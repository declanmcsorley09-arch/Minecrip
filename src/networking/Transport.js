/**
 * Abstract bidirectional message channel. Implementations buffer incoming
 * messages; the owner drains them at a well-defined point in its loop with
 * {@link Transport#receive}, which keeps message handling deterministic and
 * free of re-entrancy.
 */
export class Transport {
  constructor() {
    /** @type {object[]} */
    this.inbox = [];
    this.closed = false;
    /** Called once when the channel closes. @type {(() => void)|null} */
    this.onClose = null;
  }

  /**
   * Sends a message to the remote end.
   * @param {object} _msg
   */
  send(_msg) {
    throw new Error('Transport.send not implemented');
  }

  /**
   * Returns and clears all messages received so far.
   * @returns {object[]}
   */
  receive() {
    if (this.inbox.length === 0) return EMPTY;
    const msgs = this.inbox;
    this.inbox = [];
    return msgs;
  }

  /** Closes the channel. */
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.onClose) this.onClose();
  }
}

const EMPTY = Object.freeze([]);
