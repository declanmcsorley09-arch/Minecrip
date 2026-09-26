import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsBody } from '../src/physics/PhysicsBody.js';
import { raycastVoxels } from '../src/physics/VoxelRaycast.js';
import { AABB } from '../src/physics/AABB.js';
import { BlockIds } from '../src/blocks/index.js';

/** Flat world: stone at y <= 10 plus custom blocks. */
function flatWorld(extra = {}) {
  return {
    getBlock(x, y, z) {
      const k = `${x},${y},${z}`;
      if (k in extra) return extra[k];
      return y <= 10 ? BlockIds.stone : 0;
    },
  };
}

function run(body, world, seconds, opts, each) {
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) { if (each) each(); body.step(world, dt, opts); }
}

test('body falls and lands on the ground', () => {
  const world = flatWorld();
  const b = new PhysicsBody({ width: 0.6, height: 1.8 });
  b.setPosition(0.5, 20, 0.5);
  let landed = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) { const ev = b.step(world, dt); if (ev.landed) landed = ev.landed; }
  assert.ok(b.onGround);
  assert.ok(Math.abs(b.position.y - 11) < 1e-9);
  assert.ok(landed > 8.5 && landed < 9.5, `fall distance ${landed}`);
});

test('walls stop motion and allow sliding', () => {
  const extra = {};
  for (let z = -5; z <= 5; z++) for (let y = 11; y <= 13; y++) extra[`3,${y},${z}`] = BlockIds.stone;
  const world = flatWorld(extra);
  const b = new PhysicsBody({ width: 0.6, height: 1.8 });
  b.setPosition(0.5, 11, 0.5);
  run(b, world, 1, {}, () => { b.velocity.x = 4; b.velocity.z = 2; });
  assert.ok(Math.abs(b.box.maxX - 3) < 1e-9, `x ${b.box.maxX}`);
  assert.ok(b.position.z > 2, 'slid along the wall');
});

test('step-up is limited by step height', () => {
  const world = flatWorld({ '2,11,0': BlockIds.cactus });
  const b = new PhysicsBody({ width: 0.6, height: 1.8, stepHeight: 0.6 });
  b.setPosition(0.5, 11, 0.5);
  run(b, world, 0.5, {}, () => { b.velocity.x = 3; });
  assert.ok(b.position.x < 2, 'full-height obstacle blocks a 0.6 step');
  const b2 = new PhysicsBody({ width: 0.6, height: 1.8, stepHeight: 1.0 });
  const w2 = flatWorld({ '2,11,0': BlockIds.stone, '3,11,0': BlockIds.stone, '4,11,0': BlockIds.stone });
  b2.setPosition(0.5, 11, 0.5);
  run(b2, w2, 1, {}, () => { b2.velocity.x = 3; });
  assert.ok(b2.position.x > 3 && Math.abs(b2.position.y - 12) < 1e-9, `stepped to ${b2.position.x},${b2.position.y}`);
});

test('sneak edge guard prevents walking off a ledge', () => {
  const extra = {};
  for (let x = -3; x <= 1; x++) extra[`${x},11,0`] = BlockIds.stone;
  const world = { getBlock: (x, y, z) => extra[`${x},${y},${z}`] ?? (y <= 5 ? 1 : 0) };
  const b = new PhysicsBody({ width: 0.6, height: 1.8 });
  b.setPosition(0.5, 12, 0.5);
  run(b, world, 0.2, {});
  assert.ok(b.onGround);
  run(b, world, 2, { edgeGuard: true }, () => { b.velocity.x = 2; });
  assert.ok(b.box.minX <= 2 + 1e-9, `stayed on ledge ${b.box.minX}`);
  assert.equal(b.position.y, 12);
});

test('voxel raycast finds faces and selection boxes', () => {
  const world = flatWorld({ '5,11,0': BlockIds.poppy });
  const down = raycastVoxels(world, 0.5, 15, 0.5, 0, -1, 0, 10);
  assert.equal(down.y, 10);
  assert.equal(down.face, 2);
  assert.ok(Math.abs(down.distance - 4) < 1e-9);
  const side = raycastVoxels(world, 0.5, 11.3, 0.5, 1, 0, 0, 10);
  assert.equal(side.x, 5);
  assert.equal(side.id, BlockIds.poppy);
  const miss = raycastVoxels(world, 0.5, 11.95, 0.5, 1, 0, 0, 10);
  assert.equal(miss, null, 'passes above the flower selection box');
  assert.equal(raycastVoxels(world, 0.5, 15, 0.5, 0, -1, 0, 3), null);
});

test('aabb ray intersection', () => {
  const b = new AABB(1, 1, 1, 2, 2, 2);
  const h = b.raycast(0, 1.5, 1.5, 1, 0, 0);
  assert.equal(h.t, 1);
  assert.equal(h.face, 1);
  assert.equal(b.raycast(0, 3, 1.5, 1, 0, 0), null);
});
