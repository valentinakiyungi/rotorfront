// Simulation tests. Run with: npm test (node's built-in runner via tsx).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUILDINGS,
  Commander,
  MAPS,
  START_SCRAP,
  TICK_RATE,
  UNITS,
  createWorld,
  getMap,
  issue,
  placementError,
  step,
  worldHash,
  type World,
} from '../src/sim';
import { spawnUnit } from '../src/sim/world';

const run = (world: World, seconds: number, ais: Commander[] = []) => {
  for (let i = 0; i < seconds * TICK_RATE && world.winner === null; i++) {
    for (const ai of ais) ai.think(world);
    step(world);
  }
};

test('every map is symmetric and both bases connect by ground', () => {
  for (const info of MAPS) {
    const m = info.build();
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++)
        assert.equal(m.tiles[y * m.width + x], m.tiles[(m.height - 1 - y) * m.width + (m.width - 1 - x)], `${info.id} ${x},${y}`);
    assert.ok(m.crystals.length >= 10, `${info.id} has crystals`);
    // A unit can drive from one base to the other.
    const w = createWorld(m, 1);
    const blueSkiff = w.units.find((u) => u.team === 0 && u.kind === 'skiff')!;
    const red = m.starts[1];
    issue(w, { t: 'move', team: 0, ids: [blueSkiff.id], x: red.tx + 1.5, y: red.ty + 5 });
    run(w, 60);
    assert.ok(Math.hypot(blueSkiff.x - (red.tx + 1.5), blueSkiff.y - (red.ty + 5)) < 4, `${info.id}: skiff reached the enemy base`);
  }
});

test('harvesters bring scrap home', () => {
  const w = createWorld(getMap('proving'), 1);
  run(w, 40);
  assert.ok(w.teams[0].scrap > START_SCRAP, `blue scrap ${w.teams[0].scrap}`);
  assert.ok(w.teams[0].stats.harvested >= 100);
});

test('training costs scrap and produces the unit', () => {
  const w = createWorld(getMap('proving'), 1);
  const hq = w.buildings.find((b) => b.team === 0 && b.kind === 'hq')!;
  issue(w, { t: 'train', team: 0, building: hq.id, kind: 'mule' });
  step(w);
  assert.equal(w.teams[0].scrap, START_SCRAP - UNITS.mule.cost);
  run(w, UNITS.mule.buildTime + 0.5);
  assert.equal(w.units.filter((u) => u.team === 0 && u.kind === 'mule').length, 3);
});

test('buildings need scrap, space and their prerequisites', () => {
  const w = createWorld(getMap('proving'), 1);
  const s = w.map.starts[0];
  assert.match(placementError(w, 0, 'aerie', s.tx + 4, s.ty - 4) ?? '', /Foundry/);
  assert.equal(placementError(w, 0, 'foundry', s.tx, s.ty), 'Blocked');
  const farErrors = new Set<string | null>();
  for (let y = 2; y < 12; y++) for (let x = 28; x < 38; x++) farErrors.add(placementError(w, 0, 'foundry', x, y));
  assert.ok(farErrors.has('Too far from your base'), [...farErrors].join(', '));
  assert.ok(!farErrors.has(null), 'nothing near the enemy base is buildable for blue');
  let spot: [number, number] | null = null;
  for (let dy = -6; dy <= 6 && !spot; dy++)
    for (let dx = -6; dx <= 6 && !spot; dx++) if (!placementError(w, 0, 'foundry', s.tx + dx, s.ty + dy)) spot = [s.tx + dx, s.ty + dy];
  assert.ok(spot);
  issue(w, { t: 'build', team: 0, kind: 'foundry', tx: spot![0], ty: spot![1] });
  run(w, BUILDINGS.foundry.buildTime + 0.5);
  assert.ok(w.buildings.some((b) => b.team === 0 && b.kind === 'foundry' && b.complete));
});

test('rams beat skiffs, darts beat rams, thistles beat darts', () => {
  const duel = (a: keyof typeof UNITS, b: keyof typeof UNITS, na = 3, nb = 3) => {
    const w = createWorld(getMap('proving'), 1);
    w.units = []; w.byId.clear();
    for (const bld of w.buildings) w.byId.set(bld.id, bld);
    for (let i = 0; i < na; i++) spawnUnit(w, 0, a, 20 + i * 0.9, 24);
    for (let i = 0; i < nb; i++) spawnUnit(w, 1, b, 20 + i * 0.9, 19);
    // Find open ground near the middle so terrain doesn't decide the fight.
    for (const u of w.units) u.order = { type: 'attackMove', x: 21, y: u.team === 0 ? 17 : 26 };
    run(w, 60);
    const left = (t: 0 | 1) => w.units.filter((u) => u.team === t && u.kind === (t === 0 ? a : b)).length;
    return [left(0), left(1)];
  };
  const [ram, skiff] = duel('ram', 'skiff', 2, 3);
  assert.ok(ram > 0 && skiff === 0, `ram ${ram} skiff ${skiff}`);
  const [dart, ram2] = duel('dart', 'ram', 2, 2);
  assert.ok(dart > 0 && ram2 === 0, `dart ${dart} ram ${ram2}`);
  const [thistle, dart2] = duel('thistle', 'dart', 3, 3);
  assert.ok(thistle > 0 && dart2 === 0, `thistle ${thistle} dart ${dart2}`);
});

test('the same seed and commands replay to the same world', () => {
  const play = () => {
    const w = createWorld(getMap('fords'), 99);
    run(w, 120, [new Commander(0, 'balanced', 'hard', 99), new Commander(1, 'air', 'hard', 99)]);
    return w;
  };
  const a = play(), b = play();
  assert.equal(worldHash(a), worldHash(b));

  // Replaying only the command log reproduces the match with no AI at all.
  const r = createWorld(getMap('fords'), 99);
  let i = 0;
  while (r.tick < a.tick) {
    while (i < a.log.length && a.log[i].tick === r.tick) issue(r, a.log[i++].cmd);
    step(r);
  }
  assert.equal(worldHash(r), worldHash(a));
});

test('AI vs AI matches end with a winner', () => {
  const w = createWorld(getMap('proving'), 3);
  run(w, 60 * 20, [new Commander(0, 'balanced', 'normal', 3), new Commander(1, 'rush', 'normal', 3)]);
  assert.notEqual(w.winner, null);
});
