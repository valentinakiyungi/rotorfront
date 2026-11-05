// World creation and shared helpers used by every system.
import { BUILD_RADIUS, BUILDINGS, CRYSTAL_AMOUNT, RICH_CRYSTAL_AMOUNT, START_SCRAP, UNITS, ticks } from './balance';
import {
  Terrain,
  type Building,
  type BuildingKind,
  type Crystal,
  type GameMap,
  type Team,
  type TeamState,
  type Unit,
  type UnitKind,
  type World,
} from './types';

function teamState(): TeamState {
  return {
    scrap: START_SCRAP,
    stats: { harvested: 0, spent: 0, unitsBuilt: 0, unitsLost: 0, kills: 0, armyValueTimeline: [] },
  };
}

export function createWorld(map: GameMap, seed = 1): World {
  const n = map.width * map.height;
  const world: World = {
    tick: 0,
    seed,
    rngState: seed >>> 0,
    map,
    units: [],
    buildings: [],
    crystals: [],
    projectiles: [],
    byId: new Map(),
    crystalById: new Map(),
    teams: [teamState(), teamState()],
    nextId: 1,
    occupancy: new Int32Array(n),
    crystalAt: new Int32Array(n),
    visible: [new Uint8Array(n), new Uint8Array(n)],
    explored: [new Uint8Array(n), new Uint8Array(n)],
    pending: [],
    log: [],
    events: [],
    winner: null,
  };
  for (const c of map.crystals) {
    const id = world.nextId++;
    const crystal = { id, tx: c.tx, ty: c.ty, amount: c.rich ? RICH_CRYSTAL_AMOUNT : CRYSTAL_AMOUNT, rich: c.rich };
    world.crystals.push(crystal);
    world.crystalById.set(id, crystal);
    world.crystalAt[c.ty * map.width + c.tx] = id;
  }
  for (const team of [0, 1] as Team[]) {
    const s = map.starts[team];
    const hq = placeBuilding(world, team, 'hq', s.tx, s.ty, true);
    // Two harvesters and two light tanks to start.
    const below = team === 0 ? -1 : 3;
    spawnUnit(world, team, 'mule', s.tx + 3.5, s.ty + 0.5);
    spawnUnit(world, team, 'mule', s.tx + 3.5, s.ty + 2.5);
    spawnUnit(world, team, 'skiff', s.tx + 0.5, s.ty + below + 0.5);
    spawnUnit(world, team, 'skiff', s.tx + 2.5, s.ty + below + 0.5);
    void hq;
  }
  // Starting harvesters go to work.
  for (const u of world.units) {
    if (u.kind === 'mule') {
      const c = nearestCrystal(world, u.x, u.y);
      if (c) u.order = { type: 'harvest', crystal: c.id, phase: 'toField' };
    }
  }
  return world;
}

export function spawnUnit(world: World, team: Team, kind: UnitKind, x: number, y: number): Unit {
  const def = UNITS[kind];
  const unit: Unit = {
    id: world.nextId++,
    team, kind, x, y, px: x, py: y,
    facing: team === 0 ? -Math.PI / 4 : (Math.PI * 3) / 4,
    hp: def.hp,
    order: { type: 'idle' },
    path: null,
    pathGoal: null,
    repathIn: 0,
    cooldown: 0,
    target: 0,
    lastAttacker: 0,
    cargo: 0,
    kills: 0,
    rank: 0,
    stuckTicks: 0,
  };
  world.units.push(unit);
  world.byId.set(unit.id, unit);
  return unit;
}

export function placeBuilding(world: World, team: Team, kind: BuildingKind, tx: number, ty: number, instant = false): Building {
  const def = BUILDINGS[kind];
  const b: Building = {
    id: world.nextId++,
    team, kind, tx, ty,
    size: def.size,
    hp: instant ? def.hp : Math.max(1, Math.round(def.hp * 0.1)),
    progress: instant ? ticks(def.buildTime) : 0,
    complete: instant,
    queue: [],
    prodTicks: 0,
    rally: null,
    cooldown: 0,
    target: 0,
    lastAttacker: 0,
  };
  world.buildings.push(b);
  world.byId.set(b.id, b);
  const w = world.map.width;
  for (let y = ty; y < ty + def.size; y++) for (let x = tx; x < tx + def.size; x++) world.occupancy[y * w + x] = b.id;
  return b;
}

export function terrainAt(world: World, tx: number, ty: number): number {
  const { width, height, tiles } = world.map;
  if (tx < 0 || ty < 0 || tx >= width || ty >= height) return Terrain.Rock;
  return tiles[ty * width + tx];
}

/** Can a ground unit stand on this tile? */
export function groundPassable(world: World, tx: number, ty: number): boolean {
  const t = terrainAt(world, tx, ty);
  if (t === Terrain.Rock || t === Terrain.Water) return false;
  return world.occupancy[ty * world.map.width + tx] === 0;
}

export function inMap(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.map.width && y < world.map.height;
}

export function buildingCentre(b: Building): { x: number; y: number } {
  return { x: b.tx + b.size / 2, y: b.ty + b.size / 2 };
}

/** Distance from a point to the nearest edge of an entity (0 inside a building). */
export function distTo(world: World, x: number, y: number, id: number): number {
  const e = world.byId.get(id);
  if (!e) return Infinity;
  if ('size' in e) {
    const dx = Math.max(e.tx - x, 0, x - (e.tx + e.size));
    const dy = Math.max(e.ty - y, 0, y - (e.ty + e.size));
    return Math.hypot(dx, dy);
  }
  return Math.hypot(e.x - x, e.y - y);
}

export function entityPos(e: Unit | Building): { x: number; y: number } {
  return 'size' in e ? buildingCentre(e) : { x: e.x, y: e.y };
}

export function nearestCrystal(world: World, x: number, y: number, exclude = 0): Crystal | null {
  let best = null;
  let bestD = Infinity;
  for (const c of world.crystals) {
    if (c.amount <= 0 || c.id === exclude) continue;
    const d = Math.hypot(c.tx + 0.5 - x, c.ty + 0.5 - y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

export function nearestDropOff(world: World, team: Team, x: number, y: number): Building | null {
  let best = null;
  let bestD = Infinity;
  for (const b of world.buildings) {
    if (b.team !== team || !b.complete || !BUILDINGS[b.kind].dropOff) continue;
    const d = distTo(world, x, y, b.id);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

export function hasBuilding(world: World, team: Team, kind: BuildingKind, completeOnly = true): boolean {
  return world.buildings.some((b) => b.team === team && b.kind === kind && (!completeOnly || b.complete));
}

/** Why a building can't go here, or null if it can. */
export function placementError(world: World, team: Team, kind: BuildingKind, tx: number, ty: number): string | null {
  const def = BUILDINGS[kind];
  if (def.requires && !hasBuilding(world, team, def.requires)) return `Needs a ${BUILDINGS[def.requires].name}`;
  if (world.teams[team].scrap < def.cost) return 'Not enough scrap';
  const w = world.map.width;
  for (let y = ty; y < ty + def.size; y++)
    for (let x = tx; x < tx + def.size; x++) {
      if (!inMap(world, x, y)) return 'Off the map';
      const t = terrainAt(world, x, y);
      if (t === Terrain.Rock || t === Terrain.Water) return 'Bad ground';
      if (world.occupancy[y * w + x]) return 'Blocked';
      if (world.crystalAt[y * w + x]) return 'On crystals';
    }
  const cx = tx + def.size / 2, cy = ty + def.size / 2;
  const near = world.buildings.some(
    (b) => b.team === team && b.complete && Math.hypot(buildingCentre(b).x - cx, buildingCentre(b).y - cy) <= BUILD_RADIUS_FOR(b),
  );
  if (!near) return 'Too far from your base';
  // Enemy units standing on the footprint block it; ours get nudged out of the way.
  for (const u of world.units) {
    if (u.team === team || UNITS[u.kind].layer === 'air') continue;
    if (u.x > tx - 0.3 && u.x < tx + def.size + 0.3 && u.y > ty - 0.3 && u.y < ty + def.size + 0.3) return 'Enemy in the way';
  }
  return null;
}

function BUILD_RADIUS_FOR(b: Building): number {
  return b.kind === 'turret' ? 0 : BUILD_RADIUS;
}

/** The closest tile centre a ground unit can stand on, searching outward. */
export function nearestPassable(world: World, x: number, y: number, maxR = 12): { x: number; y: number } | null {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (inMap(world, cx, cy) && groundPassable(world, cx, cy)) return { x, y };
  for (let r = 1; r <= maxR; r++) {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx, ty = cy + dy;
        if (!inMap(world, tx, ty) || !groundPassable(world, tx, ty)) continue;
        const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
        if (d < bestD) { bestD = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
      }
    if (best) return best;
  }
  return null;
}

export function armyValue(world: World, team: Team): number {
  let v = 0;
  for (const u of world.units) if (u.team === team && u.kind !== 'mule') v += UNITS[u.kind].cost;
  return v;
}
