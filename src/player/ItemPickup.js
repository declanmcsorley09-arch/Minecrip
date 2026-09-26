import { ItemStack } from '../inventory/ItemStack.js';

const PICKUP_RADIUS = 1.6;
const RETRY = 0.3;

/**
 * Requests pickup of dropped items the player walks over, bounded by free
 * inventory capacity, and stores items granted by the server.
 */
export class ItemPickup {
  /**
   * @param {import('./Player.js').Player} player
   * @param {import('../networking/GameClient.js').GameClient} client
   */
  constructor(player, client) {
    this.player = player;
    this.client = client;
    /** @type {Map<number, number>} entity id → next allowed request time */
    this.cooldowns = new Map();
    this.time = 0;
    this.onPickup = (msg) => this.receive(msg);
    client.on('pickup', this.onPickup);
    /** Called with the stack after a successful pickup. @type {((stack: ItemStack) => void)|null} */
    this.onCollected = null;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    this.time += dt;
    const p = this.player;
    if (p.dead) return;
    const pos = p.body.position;
    const cy = pos.y + 0.9;
    for (const e of this.client.entities.values()) {
      if (e.type !== 'item') continue;
      const dx = e.x - pos.x;
      const dy = e.y - cy;
      const dz = e.z - pos.z;
      if (dx * dx + dy * dy * 0.5 + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) continue;
      const next = this.cooldowns.get(e.id) ?? 0;
      if (this.time < next) continue;
      this.cooldowns.set(e.id, this.time + RETRY);
      const capacity = p.inventory.capacityFor(e.data.id);
      if (capacity > 0) this.client.requestPickup(e.id, capacity);
    }
    if (this.cooldowns.size > 64) {
      for (const id of this.cooldowns.keys()) if (!this.client.entities.has(id)) this.cooldowns.delete(id);
    }
  }

  /** @private */
  receive(msg) {
    const stack = ItemStack.fromJSON(msg.stack);
    if (!stack) return;
    const left = this.player.inventory.add(stack);
    if (left > 0) {
      const pos = this.player.body.position;
      this.client.dropItem({ id: stack.id, count: left, damage: stack.damage }, { x: pos.x, y: pos.y + 1, z: pos.z }, { x: 0, y: 2, z: 0 });
    }
    if (this.onCollected) this.onCollected(stack);
  }

  /** Stops listening. */
  dispose() {
    this.client.off('pickup', this.onPickup);
  }
}
