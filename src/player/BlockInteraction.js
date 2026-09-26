import { EventEmitter } from '../utils/EventEmitter.js';
import { raycastVoxels } from '../physics/VoxelRaycast.js';
import { AABB } from '../physics/AABB.js';
import { blockRegistry } from '../blocks/index.js';
import { resolvePlacement, canBlockStay } from '../blocks/BlockBehaviors.js';
import { itemRegistry } from '../items/index.js';
import { getBreakTime } from '../items/Mining.js';
import { ENTITY_TYPES } from '../entities/EntityTypes.js';
import { ItemStack } from '../inventory/ItemStack.js';

const PLACE_REPEAT = 0.22;
const CREATIVE_BREAK_REPEAT = 0.2;
const ATTACK_COOLDOWN = 0.3;
const EAT_TIME = 1.1;

/**
 * Handles everything the player does with the mouse in the world: block
 * targeting, progressive mining (survival) or instant breaking (creative),
 * placement with validation, entity attacks, eating, pick-block and item
 * dropping. World changes are sent through the {@link GameClient}.
 *
 * Events: `dig` (hit info while mining), `blockBreak`, `blockPlace`,
 * `attack`, `swing`, `eat`, `eating`, `openContainer` ({x,y,z,kind}),
 * `drop`, `toolBroke`.
 */
export class BlockInteraction extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('./Player.js').Player} deps.player
   * @param {import('./InputManager.js').InputManager} deps.input
   * @param {import('../world/World.js').World} deps.world
   * @param {import('../networking/GameClient.js').GameClient} deps.client
   */
  constructor({ player, input, world, client }) {
    super();
    this.player = player;
    this.input = input;
    this.world = world;
    this.client = client;
    /** @type {import('../physics/VoxelRaycast.js').RayHit|null} */
    this.target = null;
    /** @type {import('../networking/GameClient.js').RemoteEntity|null} */
    this.entityTarget = null;
    this.breakProgress = 0;
    this.breakKey = '';
    this.digTimer = 0;
    this.placeTimer = 0;
    this.breakTimer = 0;
    this.attackTimer = 0;
    this.eatTimer = 0;
    this.box = new AABB();
  }

  /** Current crack stage 0..9, or -1 when not mining. */
  get crackStage() {
    return this.breakProgress > 0 ? Math.min(9, Math.floor(this.breakProgress * 10)) : -1;
  }

  /**
   * Per-frame update.
   * @param {number} dt
   * @param {{x:number,y:number,z:number}} eye camera position
   * @param {{x:number,y:number,z:number}} dir unit look direction
   */
  update(dt, eye, dir) {
    const p = this.player;
    this.placeTimer -= dt;
    this.breakTimer -= dt;
    this.attackTimer -= dt;
    if (p.dead) {
      this.target = null;
      this.entityTarget = null;
      this.resetBreaking();
      return;
    }
    const reach = p.reach;
    this.target = raycastVoxels(this.world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, reach);
    this.entityTarget = this.pickEntity(eye, dir, this.target ? this.target.distance : reach);

    this.handleHotbar();
    this.handleAttackAndMining(dt);
    this.handleUse(dt);
    if (this.input.mousePressed(1)) this.pickBlock();
    if (this.input.wasPressed('drop')) this.dropHeld(this.input.isDown('sprint'), eye, dir);
  }

  /** @private */
  handleHotbar() {
    const inv = this.player.inventory;
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) inv.select(inv.selected + wheel);
    for (let i = 0; i < 9; i++) if (this.input.codePressed(`Digit${i + 1}`)) inv.select(i);
  }

  /** Ray/AABB test against nearby mobs. @private */
  pickEntity(eye, dir, maxDist) {
    let best = null;
    let bestT = Math.min(maxDist, this.player.creative ? 5 : 3.5);
    for (const e of this.client.entities.values()) {
      const info = ENTITY_TYPES[e.type];
      if (!info || info.category === 'misc' || e.flags & 2) continue;
      const w = info.width / 2 + 0.1;
      this.box.set(e.x - w, e.y, e.z - w, e.x + w, e.y + info.height + 0.1, e.z + w);
      const hit = this.box.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        best = e;
      }
    }
    return best;
  }

  /** @private */
  resetBreaking() {
    this.breakProgress = 0;
    this.breakKey = '';
  }

  /** @private */
  handleAttackAndMining(dt) {
    const p = this.player;
    const input = this.input;
    const held = p.inventory.held;
    const heldId = held ? held.id : 0;

    if (this.entityTarget && input.mousePressed(0) && this.attackTimer <= 0) {
      this.attackTimer = ATTACK_COOLDOWN;
      this.client.attack(this.entityTarget.id, heldId, p.sprinting);
      this.swing();
      this.emit('attack', this.entityTarget);
      if (!p.creative && held?.def?.tool) this.wearTool(held.def.tool.type === 'sword' ? 1 : 2);
      this.resetBreaking();
      return;
    }

    const t = this.target;
    if (!input.mouseDown(0) || !t || this.entityTarget) {
      this.resetBreaking();
      return;
    }

    if (p.creative) {
      if (input.mousePressed(0) || this.breakTimer <= 0) {
        this.breakTimer = CREATIVE_BREAK_REPEAT;
        this.breakBlock(t, heldId);
      }
      return;
    }

    const key = `${t.x},${t.y},${t.z}`;
    if (key !== this.breakKey) {
      this.breakKey = key;
      this.breakProgress = 0;
      this.digTimer = 0;
    }
    if (this.breakTimer > 0) return;
    const time = getBreakTime(t.id, heldId);
    if (!Number.isFinite(time)) return;
    this.breakProgress += time <= 0 ? 1 : dt / time;
    this.digTimer -= dt;
    if (this.digTimer <= 0) {
      this.digTimer = 0.22;
      this.swing();
      this.emit('dig', t);
    }
    if (this.breakProgress >= 1) {
      this.breakBlock(t, heldId);
      this.breakTimer = 0.18;
      this.resetBreaking();
    }
  }

  /** @private */
  breakBlock(t, heldId) {
    const def = blockRegistry.get(t.id);
    if (def.hardness < 0 && !this.player.creative) return;
    this.client.breakBlock(t.x, t.y, t.z, heldId);
    this.swing();
    this.emit('blockBreak', { x: t.x, y: t.y, z: t.z, id: t.id });
    if (!this.player.creative && def.hardness > 0) this.wearTool(1);
  }

  /** @private */
  wearTool(amount) {
    if (this.player.inventory.damageHeld(amount)) this.emit('toolBroke');
  }

  /** @private */
  handleUse(dt) {
    const p = this.player;
    const input = this.input;
    const held = p.inventory.held;
    const def = held?.def;

    // Eating (hold right mouse).
    if (def?.food && input.mouseDown(2) && (p.health < p.maxHealth || p.creative) && !(this.target && blockRegistry.get(this.target.id).interaction)) {
      this.eatTimer += dt;
      this.emit('eating', held);
      if (this.eatTimer >= EAT_TIME) {
        this.eatTimer = 0;
        this.client.useItem(held.id);
        if (!p.creative) p.inventory.consumeHeld();
        this.emit('eat', held);
      }
      return;
    }
    this.eatTimer = 0;

    if (!input.mouseDown(2)) {
      this.placeTimer = 0;
      return;
    }
    if (!input.mousePressed(2) && this.placeTimer > 0) return;
    this.placeTimer = PLACE_REPEAT;
    const t = this.target;
    if (!t) return;

    const targetDef = blockRegistry.get(t.id);
    if (targetDef.interaction && !p.sneaking) {
      if (input.mousePressed(2)) {
        this.swing();
        this.emit('openContainer', { x: t.x, y: t.y, z: t.z, kind: targetDef.interaction });
      }
      return;
    }
    if (!def || !def.blockId) return;
    this.placeBlock(t, def.blockId);
  }

  /** @private */
  placeBlock(t, baseId) {
    const p = this.player;
    let x = t.x;
    let y = t.y;
    let z = t.z;
    let face = t.face;
    if (!blockRegistry.replaceable[t.id] || blockRegistry.fluid[t.id]) {
      x += t.nx;
      y += t.ny;
      z += t.nz;
    } else {
      face = 2;
    }
    if (y < 0 || y > 255) return;
    const id = resolvePlacement(baseId, face, p.yaw);
    if (!id) return;
    const cur = this.world.getBlock(x, y, z);
    if (cur !== 0 && !blockRegistry.replaceable[cur]) return;
    if (cur === id) return;
    if (!canBlockStay(this.world, x, y, z, id)) return;
    const c = blockRegistry.byId[id].collision;
    if (c) {
      this.box.set(x + c[0], y + c[1], z + c[2], x + c[3], y + c[4], z + c[5]);
      if (this.box.intersects(p.body.box)) return;
      for (const e of this.client.entities.values()) {
        const info = ENTITY_TYPES[e.type];
        if (!info || info.category === 'misc') continue;
        const w = info.width / 2;
        if (e.x + w > this.box.minX && e.x - w < this.box.maxX && e.y + info.height > this.box.minY && e.y < this.box.maxY && e.z + w > this.box.minZ && e.z - w < this.box.maxZ) return;
      }
    }
    this.client.placeBlock(x, y, z, id);
    if (!p.creative) p.inventory.consumeHeld();
    this.swing();
    this.emit('blockPlace', { x, y, z, id });
  }

  /** Middle click: select (or in creative, obtain) the targeted block. @private */
  pickBlock() {
    const t = this.target;
    if (!t) return;
    const itemId = itemRegistry.itemForBlock(t.id);
    if (!itemId) return;
    const inv = this.player.inventory;
    for (let i = 0; i < 9; i++) {
      if (inv.get(i)?.id === itemId) {
        inv.select(i);
        return;
      }
    }
    if (!this.player.creative) return;
    let slot = inv.selected;
    if (inv.get(slot)) {
      for (let i = 0; i < 9; i++) {
        if (!inv.get(i)) {
          slot = i;
          break;
        }
      }
    }
    inv.set(slot, new ItemStack(itemId, 64));
    inv.select(slot);
  }

  /**
   * Throws the held item (or the whole stack).
   * @param {boolean} wholeStack
   * @param {{x:number,y:number,z:number}} eye
   * @param {{x:number,y:number,z:number}} dir
   */
  dropHeld(wholeStack, eye, dir) {
    const inv = this.player.inventory;
    const held = inv.held;
    if (!held) return;
    const stack = wholeStack ? held.split(held.count) : held.split(1);
    if (held.count <= 0) inv.set(inv.selected, null);
    else inv.set(inv.selected, held);
    this.client.dropItem(stack.toJSON(), { x: eye.x, y: eye.y - 0.3, z: eye.z }, { x: dir.x * 5, y: dir.y * 5 + 1.5, z: dir.z * 5 });
    this.swing();
    this.emit('drop', stack);
  }

  /** Starts the arm swing animation. */
  swing() {
    if (this.player.swingTime <= 0.05) this.player.swingTime = 0.3;
    this.emit('swing');
  }
}
