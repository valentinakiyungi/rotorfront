// One fixed simulation step. step(world) advances the match by 1/TICK_RATE seconds.
import {
  BUILDINGS,
  DAMAGE_TABLE,
  DT,
  FOG_UPDATE_TICKS,
  MINE_RATE,
  RANK_DAMAGE_BONUS,
  RANK_KILLS,
  RICH_MINE_BONUS,
  TICK_RATE,
  UNITS,
  ticks,
} from './balance';
import { applyCommand, canHit } from './commands';
import { findPath } from './path';
import {
  Terrain,
  isBuilding,
  isUnit,
  type Building,
  type DamageType,
  type Team,
  type Unit,
  type WeaponDef,
  type World,
} from './types';
import {
  armyValue,
  buildingCentre,
  distTo,
  groundPassable,
  nearestCrystal,
  nearestDropOff,
  nearestPassable,
  spawnUnit,
  terrainAt,
} from './world';

export function step(world: World): void {
  world.events = [];
  if (world.winner !== null) return;

  const cmds = world.pending;
  world.pending = [];
  for (const c of cmds) applyCommand(world, c);

  for (const u of world.units) { u.px = u.x; u.py = u.y; }

  if (world.tick % FOG_UPDATE_TICKS === 0) updateFog(world);
  for (const b of world.buildings) updateBuilding(world, b);
  for (const u of world.units) if (u.hp > 0) updateUnit(world, u);
  separate(world);
  updateProjectiles(world);
  removeDead(world);
  checkVictory(world);

  if (world.tick % (TICK_RATE * 5) === 0) {
    for (const t of [0, 1] as Team[]) world.teams[t].stats.armyValueTimeline.push(armyValue(world, t));
  }
  world.tick++;
}

// ---------------------------------------------------------------- fog of war

export function updateFog(world: World): void {
  const w = world.map.width, h = world.map.height;
  for (const t of [0, 1] as Team[]) {
    const vis = world.visible[t];
    vis.fill(0);
    const reveal = (cx: number, cy: number, r: number) => {
      const r2 = r * r;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r2) vis[y * w + x] = 1;
        }
    };
    for (const u of world.units) if (u.team === t) reveal(u.x, u.y, UNITS[u.kind].sight);
    for (const b of world.buildings) {
      if (b.team !== t) continue;
      const c = buildingCentre(b);
      reveal(c.x, c.y, BUILDINGS[b.kind].sight + b.size / 2);
    }
    const ex = world.explored[t];
    for (let i = 0; i < vis.length; i++) if (vis[i]) ex[i] = 1;
  }
}

export function isVisibleTo(world: World, team: Team, id: number): boolean {
  const e = world.byId.get(id);
  if (!e) return false;
  if (e.team === team) return true;
  const w = world.map.width, vis = world.visible[team];
  if (isBuilding(e)) {
    for (let y = e.ty; y < e.ty + e.size; y++) for (let x = e.tx; x < e.tx + e.size; x++) if (vis[y * w + x]) return true;
    return false;
  }
  return vis[Math.floor(e.y) * w + Math.floor(e.x)] === 1;
}

// ---------------------------------------------------------------- buildings

function updateBuilding(world: World, b: Building): void {
  if (b.hp <= 0) return;
  const def = BUILDINGS[b.kind];
  if (!b.complete) {
    const total = ticks(def.buildTime);
    b.progress++;
    b.hp = Math.min(def.hp, b.hp + (def.hp * 0.9) / total);
    if (b.progress >= total) {
      b.complete = true;
      world.events.push({ e: 'built', id: b.id, team: b.team, kind: b.kind });
    }
    return;
  }
  if (b.queue.length) {
    const kind = b.queue[0];
    b.prodTicks++;
    if (b.prodTicks >= ticks(UNITS[kind].buildTime)) {
      const air = UNITS[kind].layer === 'air';
      const c = buildingCentre(b);
      const exitY = b.team === 0 ? b.ty - 0.5 : b.ty + b.size + 0.5;
      const spot = air ? { x: c.x, y: c.y } : nearestPassable(world, c.x, exitY, 6);
      if (spot) {
        const u = spawnUnit(world, b.team, kind, spot.x, spot.y);
        b.queue.shift();
        b.prodTicks = 0;
        world.teams[b.team].stats.unitsBuilt++;
        world.events.push({ e: 'spawn', id: u.id, team: u.team, kind });
        if (kind === 'mule') {
          const cr = nearestCrystal(world, u.x, u.y);
          if (cr) u.order = { type: 'harvest', crystal: cr.id, phase: 'toField' };
        } else if (b.rally) {
          u.order = { type: 'move', x: b.rally.x, y: b.rally.y };
        }
      }
    }
  }
  if (def.weapon) {
    if (b.cooldown > 0) b.cooldown--;
    const c = buildingCentre(b);
    const reach = def.weapon.range + b.size / 2;
    let target = b.target;
    if (!target || !validTarget(world, b.team, def.weapon, target) || distTo(world, c.x, c.y, target) > reach) {
      target = acquire(world, b.team, def.weapon, c.x, c.y, reach);
    }
    b.target = target;
    if (target && b.cooldown <= 0) {
      fire(world, b.id, b.team, c.x, c.y, def.weapon, target, 0);
      b.cooldown = ticks(def.weapon.cooldown);
    }
  }
}

// ---------------------------------------------------------------- targeting & damage

function isAir(world: World, id: number): boolean {
  const e = world.byId.get(id);
  return isUnit(e) && UNITS[e.kind].layer === 'air';
}

function validTarget(world: World, team: Team, weapon: WeaponDef, id: number): boolean {
  const e = world.byId.get(id);
  if (!e || e.hp <= 0 || e.team === team) return false;
  if (!isVisibleTo(world, team, id)) return false;
  return isAir(world, id) ? weapon.hitsAir : weapon.hitsGround;
}

/** Best enemy within radius: armed units first, then the rest, nearest first. */
function acquire(world: World, team: Team, weapon: WeaponDef, x: number, y: number, radius: number): number {
  let best = 0, bestScore = Infinity;
  const consider = (id: number, armed: boolean) => {
    if (!validTarget(world, team, weapon, id)) return;
    const d = distTo(world, x, y, id);
    if (d > radius) return;
    if (weapon.minRange && d < weapon.minRange) return;
    const score = d + (armed ? 0 : 4);
    if (score < bestScore) { bestScore = score; best = id; }
  };
  for (const u of world.units) if (u.team !== team) consider(u.id, !!UNITS[u.kind].weapon);
  for (const b of world.buildings) if (b.team !== team) consider(b.id, !!BUILDINGS[b.kind].weapon);
  return best;
}

function fire(world: World, from: number, team: Team, x: number, y: number, weapon: WeaponDef, target: number, rank: number) {
  const t = world.byId.get(target)!;
  const tp = isBuilding(t) ? buildingCentre(t) : { x: t.x, y: t.y };
  const dmg = weapon.damage * (1 + rank * RANK_DAMAGE_BONUS);
  world.events.push({ e: 'shot', from, x0: x, y0: y, x1: tp.x, y1: tp.y, type: weapon.type, team });
  if (weapon.projectileSpeed) {
    const flight = Math.max(1, Math.ceil((Math.hypot(tp.x - x, tp.y - y) / weapon.projectileSpeed) * TICK_RATE));
    world.projectiles.push({
      id: world.nextId++, team, owner: from, x, y, sx: x, sy: y, tx: tp.x, ty: tp.y,
      speed: weapon.projectileSpeed, damage: dmg, type: weapon.type, splash: weapon.splash ?? 0,
      hitsAir: weapon.hitsAir, flight, age: 0,
    });
  } else {
    damage(world, target, dmg, weapon.type, from);
  }
}

export function damage(world: World, id: number, raw: number, type: DamageType, attacker: number): void {
  const e = world.byId.get(id);
  if (!e || e.hp <= 0) return;
  let mult: number;
  if (isUnit(e)) {
    const def = UNITS[e.kind];
    mult = DAMAGE_TABLE[type][def.armor];
    if (def.layer === 'ground' && terrainAt(world, Math.floor(e.x), Math.floor(e.y)) === Terrain.Woods) mult *= 0.8;
  } else {
    mult = DAMAGE_TABLE[type].structure;
    if (mult > 0) world.events.push({ e: 'underAttack', team: e.team, x: e.tx + e.size / 2, y: e.ty + e.size / 2 });
  }
  if (mult <= 0) return;
  e.hp -= raw * mult;
  e.lastAttacker = attacker;
  if (isUnit(e) && e.kind === 'mule') {
    world.events.push({ e: 'underAttack', team: e.team, x: e.x, y: e.y });
  }
  if (e.hp <= 0) {
    e.hp = 0;
    const killer = world.byId.get(attacker);
    if (killer && killer.team !== e.team) {
      world.teams[killer.team].stats.kills++;
      if (isUnit(killer)) {
        killer.kills++;
        if (killer.rank < RANK_KILLS.length && killer.kills >= RANK_KILLS[killer.rank]) {
          killer.rank++;
          world.events.push({ e: 'rankUp', id: killer.id, team: killer.team, rank: killer.rank });
        }
      }
    }
  }
}

function updateProjectiles(world: World): void {
  const keep = [];
  for (const p of world.projectiles) {
    p.age++;
    const t = p.age / p.flight;
    p.x = p.sx + (p.tx - p.sx) * t;
    p.y = p.sy + (p.ty - p.sy) * t;
    if (p.age < p.flight) { keep.push(p); continue; }
    world.events.push({ e: 'impact', x: p.tx, y: p.ty, splash: p.splash });
    const r = Math.max(p.splash, 0.5);
    for (const u of world.units) {
      if (u.team === p.team || u.hp <= 0) continue;
      if ((UNITS[u.kind].layer === 'air') !== p.hitsAir) continue;
      const d = Math.hypot(u.x - p.tx, u.y - p.ty);
      if (d <= r) damage(world, u.id, p.damage * (1 - 0.5 * (d / r)), p.type, p.owner);
    }
    if (!p.hitsAir)
      for (const b of world.buildings) {
        if (b.team === p.team || b.hp <= 0) continue;
        const d = distTo(world, p.tx, p.ty, b.id);
        if (d <= r) damage(world, b.id, p.damage * (1 - 0.5 * (d / r)), p.type, p.owner);
      }
  }
  world.projectiles = keep;
}

// ---------------------------------------------------------------- units

function speedAt(world: World, u: Unit): number {
  const def = UNITS[u.kind];
  if (def.layer === 'air') return def.speed;
  const t = terrainAt(world, Math.floor(u.x), Math.floor(u.y));
  return def.speed * (t === Terrain.Road ? 1.25 : t === Terrain.Woods ? 0.6 : 1);
}

/** Moves u toward (x,y). Returns true once within `arrive` of it. */
function moveTo(world: World, u: Unit, x: number, y: number, arrive: number, chasing = false): boolean {
  const dist = Math.hypot(x - u.x, y - u.y);
  if (dist <= arrive) { u.path = null; return true; }
  const def = UNITS[u.kind];
  const sp = speedAt(world, u) * DT;
  if (def.layer === 'air') {
    const s = Math.min(sp, dist);
    u.facing = Math.atan2(y - u.y, x - u.x);
    u.x += ((x - u.x) / dist) * s;
    u.y += ((y - u.y) / dist) * s;
    return dist - s <= arrive;
  }
  u.repathIn--;
  const goalMoved = !u.pathGoal || Math.hypot(u.pathGoal.x - x, u.pathGoal.y - y) > (chasing ? 1.5 : 0.25);
  if (!u.path || (goalMoved && u.repathIn <= 0) || (u.stuckTicks > 15 && u.repathIn <= 0)) {
    u.path = findPath(world, u.x, u.y, x, y);
    u.pathGoal = { x, y };
    u.repathIn = chasing ? 10 : 20;
    if (u.stuckTicks > 15) u.stuckTicks = 0;
  }
  if (!u.path.length) {
    return dist <= arrive + 1.5; // goal unreachable: close enough
  }
  const wp = u.path[0];
  const d = Math.hypot(wp.x - u.x, wp.y - u.y);
  const s = Math.min(sp, d);
  if (d > 0.001) {
    const nx = u.x + ((wp.x - u.x) / d) * s, ny = u.y + ((wp.y - u.y) / d) * s;
    u.facing = Math.atan2(wp.y - u.y, wp.x - u.x);
    if (groundPassable(world, Math.floor(nx), Math.floor(ny))) { u.x = nx; u.y = ny; }
    else u.path = null;
  }
  if (d - s < 0.08 && u.path) u.path.shift();
  if (u.path && !u.path.length) {
    u.path = null;
    return Math.hypot(x - u.x, y - u.y) <= arrive + 1.5;
  }
  return false;
}

function inRange(world: World, u: Unit, w: WeaponDef, target: number): boolean {
  const d = distTo(world, u.x, u.y, target);
  return d <= w.range && !(w.minRange && d < w.minRange);
}

function tryFire(world: World, u: Unit, w: WeaponDef, target: number): boolean {
  if (!inRange(world, u, w, target)) return false;
  const t = world.byId.get(target)!;
  const tp = isBuilding(t) ? buildingCentre(t) : { x: t.x, y: t.y };
  u.facing = Math.atan2(tp.y - u.y, tp.x - u.x);
  if (u.cooldown <= 0) {
    fire(world, u.id, u.team, u.x, u.y, w, target, u.rank);
    u.cooldown = ticks(w.cooldown);
  }
  return true;
}

function updateUnit(world: World, u: Unit): void {
  const def = UNITS[u.kind];
  const w = def.weapon;
  if (u.cooldown > 0) u.cooldown--;
  const bx = u.x, by = u.y;
  u.target = 0;

  switch (u.order.type) {
    case 'idle': {
      if (!w) break;
      let t = acquire(world, u.team, w, u.x, u.y, w.range + 0.25);
      if (!t && u.lastAttacker && validTarget(world, u.team, w, u.lastAttacker) && distTo(world, u.x, u.y, u.lastAttacker) < def.sight + 2) {
        // Retaliate against something shooting us from out of range.
        u.order = { type: 'attack', target: u.lastAttacker };
        break;
      }
      if (t) { u.target = t; tryFire(world, u, w, t); }
      break;
    }
    case 'move': {
      if (w) {
        const t = acquire(world, u.team, w, u.x, u.y, w.range);
        if (t) { u.target = t; tryFire(world, u, w, t); }
      }
      if (moveTo(world, u, u.order.x, u.order.y, 0.15)) u.order = { type: 'idle' };
      break;
    }
    case 'attackMove': {
      if (w) {
        const t = acquire(world, u.team, w, u.x, u.y, def.sight);
        if (t) {
          u.target = t;
          if (!tryFire(world, u, w, t)) {
            const e = world.byId.get(t)!;
            const p = isBuilding(e) ? buildingCentre(e) : { x: e.x, y: e.y };
            moveTo(world, u, p.x, p.y, w.range * 0.9, true);
          }
          break;
        }
      }
      if (moveTo(world, u, u.order.x, u.order.y, 0.3)) u.order = { type: 'idle' };
      break;
    }
    case 'attack': {
      const id = u.order.target;
      if (!w || !validTarget(world, u.team, w, id) || !canHit(u, id, world)) { u.order = { type: 'idle' }; break; }
      u.target = id;
      if (!tryFire(world, u, w, id)) {
        const e = world.byId.get(id)!;
        const p = isBuilding(e) ? buildingCentre(e) : { x: e.x, y: e.y };
        const tooClose = w.minRange && distTo(world, u.x, u.y, id) < w.minRange;
        if (tooClose) {
          const a = Math.atan2(u.y - p.y, u.x - p.x);
          moveTo(world, u, u.x + Math.cos(a) * 2, u.y + Math.sin(a) * 2, 0.2);
        } else {
          moveTo(world, u, p.x, p.y, w.range * 0.9, true);
        }
      }
      break;
    }
    case 'harvest':
      updateHarvester(world, u);
      break;
  }

  // Stuck detection for ground units following a path.
  if (def.layer === 'ground' && u.order.type !== 'idle') {
    const moved = Math.hypot(u.x - bx, u.y - by);
    if (moved < 0.01 && u.path) u.stuckTicks++;
    else if (moved > 0.05) u.stuckTicks = Math.max(0, u.stuckTicks - 1);
    if (u.stuckTicks > 80 && u.order.type === 'move') { u.order = { type: 'idle' }; u.path = null; u.stuckTicks = 0; }
  }
}

function updateHarvester(world: World, u: Unit): void {
  if (u.order.type !== 'harvest') return;
  const def = UNITS[u.kind];
  const cap = def.capacity ?? 100;
  const o = u.order;
  let crystal = world.crystalById.get(o.crystal);
  if ((!crystal || crystal.amount <= 0) && o.phase !== 'toDrop') {
    const near = nearestCrystal(world, crystal ? crystal.tx : u.x, crystal ? crystal.ty : u.y);
    if (!near) {
      if (u.cargo > 0) o.phase = 'toDrop';
      else { u.order = { type: 'idle' }; return; }
    } else {
      o.crystal = near.id;
      crystal = near;
      o.phase = 'toField';
    }
  }
  switch (o.phase) {
    case 'toField': {
      if (!crystal) return;
      if (moveTo(world, u, crystal.tx + 0.5, crystal.ty + 0.5, 0.45)) o.phase = 'mining';
      return;
    }
    case 'mining': {
      if (!crystal) return;
      if (Math.hypot(crystal.tx + 0.5 - u.x, crystal.ty + 0.5 - u.y) > 1.0) { o.phase = 'toField'; return; }
      const rate = MINE_RATE * DT * (crystal.rich ? RICH_MINE_BONUS : 1);
      const amt = Math.min(rate, crystal.amount, cap - u.cargo);
      u.cargo += amt;
      crystal.amount -= amt;
      if (crystal.amount <= 0.001) {
        crystal.amount = 0;
        world.crystalAt[crystal.ty * world.map.width + crystal.tx] = 0;
        world.crystals = world.crystals.filter((c) => c.id !== crystal!.id);
        world.crystalById.delete(crystal.id);
        const next = nearestCrystal(world, crystal.tx, crystal.ty);
        if (next && Math.hypot(next.tx - crystal.tx, next.ty - crystal.ty) < 10) o.crystal = next.id;
      }
      if (u.cargo >= cap - 0.001 || crystal.amount <= 0) o.phase = 'toDrop';
      return;
    }
    case 'toDrop': {
      const drop = nearestDropOff(world, u.team, u.x, u.y);
      if (!drop) { u.order = { type: 'idle' }; return; }
      const c = buildingCentre(drop);
      if (distTo(world, u.x, u.y, drop.id) < 0.9) {
        const amount = Math.round(u.cargo);
        world.teams[u.team].scrap += amount;
        world.teams[u.team].stats.harvested += amount;
        world.events.push({ e: 'deposit', team: u.team, amount, x: c.x, y: c.y });
        u.cargo = 0;
        u.path = null;
        o.phase = 'toField';
        return;
      }
      moveTo(world, u, c.x, c.y, 0);
      return;
    }
  }
}

/** Push overlapping units apart (ground with ground, air with air). */
function separate(world: World): void {
  const us = world.units;
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    if (a.hp <= 0) continue;
    const da = UNITS[a.kind];
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j];
      if (b.hp <= 0) continue;
      const db = UNITS[b.kind];
      if (da.layer !== db.layer) continue;
      if (a.kind === 'mule' && b.kind === 'mule') continue; // harvesters share fields
      const min = da.radius + db.radius;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
      const d = Math.hypot(dx, dy);
      if (d >= min) continue;
      const push = (min - d) * 0.5;
      const nx = d > 1e-4 ? dx / d : (a.id % 2 ? 1 : -1), ny = d > 1e-4 ? dy / d : 0;
      // A unit that's standing still gives way more than one on the move.
      const aw = a.order.type === 'idle' ? 0.7 : 0.3, bw = b.order.type === 'idle' ? 0.7 : 0.3;
      const sum = aw + bw;
      nudge(world, a, -nx * push * 2 * (aw / sum), -ny * push * 2 * (aw / sum));
      nudge(world, b, nx * push * 2 * (bw / sum), ny * push * 2 * (bw / sum));
    }
  }
}

function nudge(world: World, u: Unit, dx: number, dy: number) {
  const nx = u.x + dx, ny = u.y + dy;
  if (UNITS[u.kind].layer === 'air') {
    u.x = Math.max(0.2, Math.min(world.map.width - 0.2, nx));
    u.y = Math.max(0.2, Math.min(world.map.height - 0.2, ny));
    return;
  }
  if (groundPassable(world, Math.floor(nx), Math.floor(ny))) { u.x = nx; u.y = ny; }
}

// ---------------------------------------------------------------- cleanup & victory

function removeDead(world: World): void {
  if (world.units.some((u) => u.hp <= 0)) {
    world.units = world.units.filter((u) => {
      if (u.hp > 0) return true;
      const def = UNITS[u.kind];
      world.byId.delete(u.id);
      world.teams[u.team].stats.unitsLost++;
      world.events.push({ e: 'death', id: u.id, x: u.x, y: u.y, team: u.team, big: def.armor === 'heavy', air: def.layer === 'air' });
      return false;
    });
  }
  if (world.buildings.some((b) => b.hp <= 0)) {
    const w = world.map.width;
    world.buildings = world.buildings.filter((b) => {
      if (b.hp > 0) return true;
      world.byId.delete(b.id);
      for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) world.occupancy[y * w + x] = 0;
      const c = buildingCentre(b);
      world.events.push({ e: 'death', id: b.id, x: c.x, y: c.y, team: b.team, big: true, air: false });
      return false;
    });
  }
}

function checkVictory(world: World): void {
  const alive = [0, 1].map((t) => world.buildings.some((b) => b.team === t && b.kind === 'hq'));
  if (alive[0] && alive[1]) return;
  world.winner = !alive[0] && !alive[1] ? 'draw' : alive[0] ? 0 : 1;
  world.events.push({ e: 'gameOver', winner: world.winner });
}
