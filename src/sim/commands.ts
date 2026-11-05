// Player and AI input. Commands are queued with issue() and applied at the start
// of the next tick, so a match is fully described by its seed plus its command log.
import { BUILDINGS, QUEUE_LIMIT, UNITS } from './balance';
import { isBuilding, isUnit, type Command, type Team, type Unit, type World } from './types';
import { nearestPassable, placeBuilding, placementError } from './world';

export function issue(world: World, cmd: Command): void {
  world.pending.push(cmd);
}

function ownUnits(world: World, team: Team, ids: number[]): Unit[] {
  const out: Unit[] = [];
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const e = world.byId.get(id);
    if (isUnit(e) && e.team === team && e.hp > 0) out.push(e);
  }
  return out;
}

export function canHit(attacker: Unit, targetId: number, world: World): boolean {
  const w = UNITS[attacker.kind].weapon;
  const t = world.byId.get(targetId);
  if (!w || !t) return false;
  const air = isUnit(t) && UNITS[t.kind].layer === 'air';
  return air ? w.hitsAir : w.hitsGround;
}

/** Spread a group's destinations into a loose block so they don't fight over one spot. */
function formation(world: World, units: Unit[], x: number, y: number): { x: number; y: number }[] {
  const n = units.length;
  const side = Math.ceil(Math.sqrt(n));
  // Sort by distance so the closest unit takes the front slot: less crossing over.
  const cx = units.reduce((s, u) => s + u.x, 0) / n;
  const cy = units.reduce((s, u) => s + u.y, 0) / n;
  const dir = Math.atan2(y - cy, x - cx);
  const fx = Math.cos(dir), fy = Math.sin(dir);
  const slots: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const col = (i % side) - (side - 1) / 2;
    const row = Math.floor(i / side);
    // rows go backwards from the target, columns across the direction of travel
    const ox = -fy * col * 1.05 - fx * row * 1.05;
    const oy = fx * col * 1.05 - fy * row * 1.05;
    slots.push({ x: x + ox, y: y + oy });
  }
  const order = units.map((u, i) => ({ u, i, d: Math.hypot(u.x - x, u.y - y) })).sort((a, b) => a.d - b.d || a.u.id - b.u.id);
  const out: { x: number; y: number }[] = new Array(n);
  order.forEach((o, k) => {
    let p = slots[k];
    if (UNITS[o.u.kind].layer === 'ground') p = nearestPassable(world, p.x, p.y) ?? p;
    out[o.i] = p;
  });
  return out;
}

export function applyCommand(world: World, cmd: Command): void {
  world.log.push({ tick: world.tick, cmd });
  const team = cmd.team;
  switch (cmd.t) {
    case 'move': {
      const units = ownUnits(world, team, cmd.ids);
      if (!units.length) return;
      const x = Math.max(0.5, Math.min(world.map.width - 0.5, cmd.x));
      const y = Math.max(0.5, Math.min(world.map.height - 0.5, cmd.y));
      const dests = formation(world, units, x, y);
      units.forEach((u, i) => {
        u.order = cmd.attack ? { type: 'attackMove', x: dests[i].x, y: dests[i].y } : { type: 'move', x: dests[i].x, y: dests[i].y };
        u.path = null;
        u.target = 0;
        u.stuckTicks = 0;
      });
      return;
    }
    case 'attack': {
      const target = world.byId.get(cmd.target);
      if (!target || target.team === team) return;
      for (const u of ownUnits(world, team, cmd.ids)) {
        if (canHit(u, cmd.target, world)) {
          u.order = { type: 'attack', target: cmd.target };
        } else {
          const p = isBuilding(target) ? { x: target.tx + target.size / 2, y: target.ty + target.size / 2 } : { x: target.x, y: target.y };
          u.order = { type: 'move', x: p.x, y: p.y };
        }
        u.path = null;
      }
      return;
    }
    case 'harvest': {
      const c = world.crystalById.get(cmd.crystal);
      if (!c || c.amount <= 0) return;
      for (const u of ownUnits(world, team, cmd.ids)) {
        if (u.kind !== 'mule') continue;
        u.order = { type: 'harvest', crystal: c.id, phase: 'toField' };
        u.path = null;
      }
      return;
    }
    case 'stop': {
      for (const u of ownUnits(world, team, cmd.ids)) {
        u.order = { type: 'idle' };
        u.path = null;
        u.target = 0;
      }
      return;
    }
    case 'train': {
      const b = world.byId.get(cmd.building);
      if (!isBuilding(b) || b.team !== team || !b.complete) return;
      const def = BUILDINGS[b.kind];
      if (!def.trains?.includes(cmd.kind) || b.queue.length >= QUEUE_LIMIT) return;
      const cost = UNITS[cmd.kind].cost;
      if (world.teams[team].scrap < cost) return;
      world.teams[team].scrap -= cost;
      world.teams[team].stats.spent += cost;
      b.queue.push(cmd.kind);
      return;
    }
    case 'cancel': {
      const b = world.byId.get(cmd.building);
      if (!isBuilding(b) || b.team !== team || !b.queue.length) return;
      const kind = b.queue.pop()!;
      if (!b.queue.length) b.prodTicks = 0;
      world.teams[team].scrap += UNITS[kind].cost;
      world.teams[team].stats.spent -= UNITS[kind].cost;
      return;
    }
    case 'build': {
      if (cmd.kind === 'hq' || placementError(world, team, cmd.kind, cmd.tx, cmd.ty)) return;
      const def = BUILDINGS[cmd.kind];
      world.teams[team].scrap -= def.cost;
      world.teams[team].stats.spent += def.cost;
      const b = placeBuilding(world, team, cmd.kind, cmd.tx, cmd.ty);
      // Nudge our own ground units off the footprint.
      for (const u of world.units) {
        if (UNITS[u.kind].layer !== 'ground') continue;
        if (u.x > b.tx - 0.4 && u.x < b.tx + b.size + 0.4 && u.y > b.ty - 0.4 && u.y < b.ty + b.size + 0.4) {
          const p = nearestPassable(world, u.x, u.y);
          if (p) { u.x = u.px = p.x; u.y = u.py = p.y; u.path = null; }
        }
      }
      return;
    }
    case 'rally': {
      const b = world.byId.get(cmd.building);
      if (!isBuilding(b) || b.team !== team) return;
      b.rally = { x: cmd.x, y: cmd.y };
      return;
    }
  }
}
