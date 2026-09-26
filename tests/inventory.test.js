import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, PlayerInventory } from '../src/inventory/Inventory.js';
import { ItemStack } from '../src/inventory/ItemStack.js';
import { recipes } from '../src/crafting/recipes.js';
import { FurnaceState, COOK_TIME } from '../src/crafting/Furnace.js';
import { ItemIds } from '../src/items/index.js';

const S = (name, n = 1) => new ItemStack(ItemIds[name], n);

test('inventory merges stacks and reports leftovers', () => {
  const inv = new Inventory(2);
  assert.equal(inv.add(S('dirt', 100)), 0);
  assert.equal(inv.get(0).count, 64);
  assert.equal(inv.get(1).count, 36);
  assert.equal(inv.add(S('stone', 5)), 5);
  assert.equal(inv.capacityFor(ItemIds.dirt), 28);
  assert.equal(inv.remove(ItemIds.dirt, 70), 70);
  assert.equal(inv.count(ItemIds.dirt), 30);
});

test('tools do not stack and wear out', () => {
  const inv = new PlayerInventory();
  inv.add(new ItemStack(ItemIds.wooden_pickaxe));
  inv.add(new ItemStack(ItemIds.wooden_pickaxe));
  assert.equal(inv.get(1).id, ItemIds.wooden_pickaxe);
  inv.get(0).damage = 58;
  assert.equal(inv.damageHeld(), true);
  assert.equal(inv.get(0), null);
});

test('crafting matches shaped, mirrored, shifted and shapeless recipes', () => {
  const g2 = [S('oak_log'), null, null, null];
  assert.equal(recipes.match(g2, 2).id, ItemIds.oak_planks);
  assert.equal(recipes.match(g2, 2).count, 4);
  const sticks = [null, S('oak_planks'), null, S('oak_planks')];
  assert.equal(recipes.match(sticks, 2).id, ItemIds.stick);
  const pick = [S('cobblestone'), S('cobblestone'), S('cobblestone'), null, S('stick'), null, null, S('stick'), null];
  assert.equal(recipes.match(pick, 3).id, ItemIds.stone_pickaxe);
  const axeMirrored = [null, S('iron_ingot'), S('iron_ingot'), null, S('stick'), S('iron_ingot'), null, S('stick'), null];
  assert.equal(recipes.match(axeMirrored, 3).id, ItemIds.iron_axe);
  const table = [S('oak_planks'), S('oak_planks'), S('oak_planks'), S('oak_planks')];
  assert.equal(recipes.match(table, 2).id, ItemIds.crafting_table);
  assert.equal(recipes.match([S('dirt'), null, null, null], 2), null);
  const furnace = [S('cobblestone'), S('cobblestone'), S('cobblestone'), S('cobblestone'), null, S('cobblestone'), S('cobblestone'), S('cobblestone'), S('cobblestone')];
  assert.equal(recipes.match(furnace, 3).id, ItemIds.furnace);
  recipes.consume(table);
  assert.deepEqual(table, [null, null, null, null]);
});

test('furnace smelts with fuel', () => {
  const f = new FurnaceState();
  f.input = S('iron_ore', 3);
  f.fuel = S('coal', 1);
  let t = 0;
  while (t < COOK_TIME * 3 + 1) { f.tick(0.5); t += 0.5; }
  assert.equal(f.output.id, ItemIds.iron_ingot);
  assert.equal(f.output.count, 3);
  assert.equal(f.input, null);
  assert.equal(f.fuel, null);
  assert.ok(f.lit, 'coal still burning');
  const g = FurnaceState.fromJSON(JSON.parse(JSON.stringify(f.toJSON())));
  assert.equal(g.output.count, 3);
});

import { clickSlot, shiftClick, distribute, collectToCursor } from '../src/inventory/SlotActions.js';
import { CraftingGrid } from '../src/inventory/CraftingGrid.js';

function slotOf(inv, i) { return { get: () => inv.get(i), set: (s) => inv.set(i, s) }; }

test('slot clicks: pick up, place, split, swap, merge', () => {
  const inv = new Inventory(4);
  inv.set(0, S('dirt', 10));
  inv.set(1, S('stone', 5));
  const cursor = { stack: null };
  clickSlot(slotOf(inv, 0), cursor, 2); // right: take half
  assert.equal(cursor.stack.count, 5);
  assert.equal(inv.get(0).count, 5);
  clickSlot(slotOf(inv, 2), cursor, 2); // place one
  assert.equal(inv.get(2).count, 1);
  assert.equal(cursor.stack.count, 4);
  clickSlot(slotOf(inv, 1), cursor, 0); // swap with stone
  assert.equal(cursor.stack.id, ItemIds.stone);
  assert.equal(inv.get(1).id, ItemIds.dirt);
  clickSlot(slotOf(inv, 3), cursor, 0);
  assert.equal(cursor.stack, null);
  collectToCursor([slotOf(inv, 0)], cursor);
  assert.equal(cursor.stack, null, 'nothing held so nothing collected');
  clickSlot(slotOf(inv, 0), cursor, 0);
  collectToCursor([slotOf(inv, 1), slotOf(inv, 2)], cursor);
  assert.equal(cursor.stack.count, 10);
});

test('drag distribution and shift-click crafting', () => {
  const inv = new Inventory(3);
  const cursor = { stack: S('oak_planks', 9) };
  distribute([slotOf(inv, 0), slotOf(inv, 1), slotOf(inv, 2)], cursor, 0);
  assert.equal(inv.get(0).count, 3);
  assert.equal(cursor.stack, null);

  const grid = new CraftingGrid(2);
  const inputs = grid.inputSlots();
  inputs[0].set(S('oak_log', 3));
  assert.equal(grid.result.id, ItemIds.oak_planks);
  const out = new Inventory(4);
  const targets = [0, 1, 2, 3].map((i) => slotOf(out, i));
  shiftClick(grid.outputSlot(), targets);
  assert.equal(out.count(ItemIds.oak_planks), 12);
  assert.equal(grid.slots[0], null);
  assert.equal(grid.result, null);
});
