// The AI commander. It plays by the same rules as a human: it only issues
// Commands, and it only reacts to enemies its own side can currently see.
import { BUILDINGS, PLACEABLE, TICK_RATE, UNITS } from '../balance';
import { issue } from '../commands';
import { Rng } from '../rng';
import { isVisibleTo } from '../tick';
import type { Building, BuildingKind, Team, Unit, UnitKind, World } from '../types';
import { buildingCentre, nearestCrystal, placementError } from '../world';

export type Personality = 'balanced' | 'rush' | 'air' | 'ironclad';
export type Difficulty = 'easy' | 'normal' | 'hard';

interface Profile {
  label: string;
  blurb: string;
  mules: number;
  buildOrder: BuildingKind[];
  weights: Partial<Record<UnitKind, number>>;
  /** Army value needed before the first attack. */
  attackAt: number;
  /** Extra army value needed per minute of game time. */
  attackGrowth: number;
}

export const PERSONALITIES: Record<Personality, Profile> = {
  balanced: {
    label: 'Balanced', blurb: 'Steady economy, mixed army, attacks in waves.',
    mules: 5, buildOrder: ['foundry', 'turret', 'aerie', 'depot', 'turret'],
    weights: { skiff: 3, ram: 2, thistle: 1, howler: 1, dart: 2, kestrel: 1 },
    attackAt: 1100, attackGrowth: 180,
  },
  rush: {
    label: 'Rush', blurb: 'Skiffs early and often. Hold on for the first three minutes.',
    mules: 5, buildOrder: ['foundry', 'foundry', 'turret', 'aerie'],
    weights: { skiff: 6, ram: 1, thistle: 0.5, howler: 0.5, dart: 1 },
    attackAt: 500, attackGrowth: 120,
  },
  air: {
    label: 'Air Swarm', blurb: 'Rushes an Aerie and raids your harvesters with drones.',
    mules: 5, buildOrder: ['foundry', 'aerie', 'turret', 'aerie', 'depot'],
    weights: { skiff: 1, thistle: 1, dart: 5, kestrel: 3 },
    attackAt: 900, attackGrowth: 160,
  },
  ironclad: {
    label: 'Ironclad', blurb: 'Turtles behind turrets, then rolls out Rams and Howlers.',
    mules: 5, buildOrder: ['foundry', 'turret', 'turret', 'depot', 'foundry', 'aerie', 'turret'],
    weights: { ram: 4, howler: 3, thistle: 1.5, skiff: 1, kestrel: 1 },
    attackAt: 2000, attackGrowth: 220,
  },
};

export const DIFFICULTIES: Record<Difficulty, { label: string; interval: number; muleBonus: number; counters: boolean; retreats: boolean }> = {
  easy: { label: 'Easy', interval: 30, muleBonus: -1, counters: false, retreats: false },
  normal: { label: 'Normal', interval: 12, muleBonus: 0, counters: true, retreats: true },
  hard: { label: 'Hard', interval: 5, muleBonus: 1, counters: true, retreats: true },
};

export class Commander {
  private rng: Rng;
  private seen = new Map<number, { kind: UnitKind; tick: number }>();
  private enemyBuildings = new Map<number, { x: number; y: number; kind: BuildingKind }>();
  private attacking = false;
  private launchedWith = 0;
  private lastPush = -9999;
  private lastRaid = -9999;
  readonly profile: Profile;
  readonly level: (typeof DIFFICULTIES)[Difficulty];

  constructor(readonly team: Team, readonly personality: Personality = 'balanced', readonly difficulty: Difficulty = 'normal', seed = 7) {
    this.rng = new Rng(seed * 31 + team * 1013);
    this.profile = PERSONALITIES[personality];
    this.level = DIFFICULTIES[difficulty];
  }

  think(world: World): void {
    if (world.winner !== null) return;
    if ((world.tick + this.team * 3) % this.level.interval !== 0) return;
    this.observe(world);
    const mine = world.units.filter((u) => u.team === this.team);
    const buildings = world.buildings.filter((b) => b.team === this.team);
    const hq = buildings.find((b) => b.kind === 'hq');
    if (!hq) return;
    this.economy(world, mine, buildings, hq);
    this.construct(world, buildings, hq);
    this.produce(world, buildings, hq);
    this.command(world, mine, buildings, hq);
  }

  // ---- what can we see?
  private observe(world: World) {
    for (const u of world.units) {
      if (u.team !== this.team && isVisibleTo(world, this.team, u.id)) this.seen.set(u.id, { kind: u.kind, tick: world.tick });
    }
    for (const b of world.buildings) {
      if (b.team !== this.team && isVisibleTo(world, this.team, b.id)) {
        const c = buildingCentre(b);
        this.enemyBuildings.set(b.id, { x: c.x, y: c.y, kind: b.kind });
      }
    }
    for (const id of [...this.seen.keys()]) if (!world.byId.has(id) || world.tick - this.seen.get(id)!.tick > TICK_RATE * 90) this.seen.delete(id);
    for (const id of [...this.enemyBuildings.keys()]) if (!world.byId.has(id)) this.enemyBuildings.delete(id);
  }

  private enemyMix(): Record<UnitKind, number> {
    const mix = { mule: 0, skiff: 0, ram: 0, thistle: 0, howler: 0, dart: 0, kestrel: 0 };
    for (const s of this.seen.values()) mix[s.kind]++;
    return mix;
  }

  // ---- harvesters
  private economy(world: World, mine: Unit[], buildings: Building[], hq: Building) {
    const mules = mine.filter((u) => u.kind === 'mule');
    const depots = buildings.filter((b) => b.kind === 'depot' && b.complete).length;
    const target = Math.max(2, this.profile.mules + this.level.muleBonus + depots * 2);
    const queued = buildings.reduce((n, b) => n + b.queue.filter((k) => k === 'mule').length, 0);
    if (mules.length + queued < target && hq.queue.length === 0 && world.teams[this.team].scrap >= UNITS.mule.cost) {
      issue(world, { t: 'train', team: this.team, building: hq.id, kind: 'mule' });
    }
    for (const m of mules) {
      if (m.order.type === 'idle') {
        const c = nearestCrystal(world, m.x, m.y);
        if (c) issue(world, { t: 'harvest', team: this.team, ids: [m.id], crystal: c.id });
      }
    }
  }

  // ---- buildings
  private construct(world: World, buildings: Building[], hq: Building) {
    const counts: Partial<Record<BuildingKind, number>> = {};
    const want: Partial<Record<BuildingKind, number>> = {};
    for (const b of buildings) counts[b.kind] = (counts[b.kind] ?? 0) + 1;
    let next: BuildingKind | null = null;
    for (const k of this.profile.buildOrder) {
      want[k] = (want[k] ?? 0) + 1;
      if ((counts[k] ?? 0) < want[k]!) { next = k; break; }
    }
    // Under air attack with nothing to shoot back? A turret jumps the queue.
    const mix = this.enemyMix();
    if (this.level.counters && mix.dart >= 3 && (counts.turret ?? 0) < 2 && counts.foundry) next = 'turret';
    if (!next || !PLACEABLE.includes(next)) return;
    if (buildings.some((b) => !b.complete && b.kind !== 'turret')) return; // one big build at a time
    const scrap = world.teams[this.team].scrap;
    if (scrap < BUILDINGS[next].cost) return;
    const spot = this.findSpot(world, next, hq);
    if (spot) issue(world, { t: 'build', team: this.team, kind: next, tx: spot.tx, ty: spot.ty });
  }

  private findSpot(world: World, kind: BuildingKind, hq: Building): { tx: number; ty: number } | null {
    const c = buildingCentre(hq);
    const enemy = world.map.starts[this.team === 0 ? 1 : 0];
    const ex = enemy.tx + 1.5, ey = enemy.ty + 1.5;
    const toward = Math.atan2(ey - c.y, ex - c.x);
    let near = c;
    let rMin = 3, rMax = 9;
    if (kind === 'turret') {
      const n = world.buildings.filter((b) => b.team === this.team && b.kind === 'turret').length;
      const a = toward + (n % 2 ? 0.6 : -0.6) * Math.ceil(n / 2);
      near = { x: c.x + Math.cos(a) * 6, y: c.y + Math.sin(a) * 6 };
      rMin = 0; rMax = 4;
    } else if (kind === 'depot') {
      // Toward the nearest crystal that isn't the home field.
      const far = world.crystals
        .map((cr) => ({ cr, d: Math.hypot(cr.tx - c.x, cr.ty - c.y) }))
        .filter((x) => x.d > 8)
        .sort((a, b) => a.d - b.d)[0];
      if (far) { near = { x: far.cr.tx, y: far.cr.ty }; rMin = 2; rMax = 6; }
    }
    const size = BUILDINGS[kind].size;
    const w = world.map.width;
    for (let r = rMin; r <= rMax; r++) {
      const ring: { tx: number; ty: number; d: number }[] = [];
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = Math.round(near.x - size / 2 + dx), ty = Math.round(near.y - size / 2 + dy);
          ring.push({ tx, ty, d: this.rng.next() });
        }
      ring.sort((a, b) => a.d - b.d);
      for (const s of ring) {
        if (placementError(world, this.team, kind, s.tx, s.ty)) continue;
        // Leave a lane around big buildings so we don't wall in our own harvesters.
        let clear = true;
        const pad = kind === 'turret' ? 0 : 1;
        for (let y = s.ty - pad; y < s.ty + size + pad && clear; y++)
          for (let x = s.tx - pad; x < s.tx + size + pad; x++) {
            if (x < 0 || y < 0 || x >= w || y >= world.map.height) continue;
            if (world.occupancy[y * w + x] || (pad && world.crystalAt[y * w + x])) { clear = false; break; }
          }
        if (clear) return s;
      }
    }
    return null;
  }

  // ---- army production
  private produce(world: World, buildings: Building[], hq: Building) {
    const mix = this.enemyMix();
    const enemyAir = mix.dart + mix.kestrel;
    const enemyTotal = Object.values(mix).reduce((a, b) => a + b, 0) - mix.mule;
    const hqc = buildingCentre(hq);
    const enemy = world.map.starts[this.team === 0 ? 1 : 0];
    const ang = Math.atan2(enemy.ty - hqc.y, enemy.tx - hqc.x);
    const rally = { x: hqc.x + Math.cos(ang) * 7, y: hqc.y + Math.sin(ang) * 7 };

    for (const b of buildings) {
      if (!b.complete) continue;
      const trains = BUILDINGS[b.kind].trains;
      if (!trains || b.kind === 'hq') continue;
      if (!b.rally) issue(world, { t: 'rally', team: this.team, building: b.id, x: rally.x, y: rally.y });
      if (b.queue.length >= 2) continue;
      const scores: [UnitKind, number][] = trains.map((k) => {
        let s = this.profile.weights[k] ?? 0.2;
        if (this.level.counters && enemyTotal > 0) {
          const airShare = enemyAir / enemyTotal;
          if (k === 'thistle' || k === 'kestrel') s *= 0.3 + airShare * 4;
          if (k === 'dart') s *= 1 + (mix.ram + mix.howler) / enemyTotal - (mix.thistle + mix.kestrel) / enemyTotal;
          if (k === 'skiff') s *= 1 + (mix.howler + mix.thistle) / enemyTotal;
          if (k === 'ram') s *= 1 + mix.skiff / enemyTotal;
        } else if (k === 'thistle' || k === 'kestrel') {
          s *= 0.4;
        }
        return [k, Math.max(0.05, s)];
      });
      const total = scores.reduce((a, [, s]) => a + s, 0);
      let r = this.rng.next() * total;
      let pick = scores[0][0];
      for (const [k, s] of scores) { r -= s; if (r <= 0) { pick = k; break; } }
      // Keep a little scrap back while a building in our plan is close to affordable.
      const reserve = world.teams[this.team].scrap - UNITS[pick].cost;
      if (reserve >= 0 && (reserve >= 150 || world.tick > TICK_RATE * 240)) {
        issue(world, { t: 'train', team: this.team, building: b.id, kind: pick });
      }
    }
  }

  // ---- army control
  private command(world: World, mine: Unit[], buildings: Building[], hq: Building) {
    const army = mine.filter((u) => u.kind !== 'mule' && UNITS[u.kind].weapon);
    if (!army.length) return;
    const value = army.reduce((v, u) => v + UNITS[u.kind].cost, 0);
    const hqc = buildingCentre(hq);

    // Defend: any visible enemy near our buildings or harvesters.
    let threat: { x: number; y: number } | null = null;
    let threatD = Infinity;
    for (const e of world.units) {
      if (e.team === this.team || !isVisibleTo(world, this.team, e.id)) continue;
      for (const b of buildings) {
        const c = buildingCentre(b);
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d < 11 && d < threatD) { threatD = d; threat = { x: e.x, y: e.y }; }
      }
    }
    if (threat && !this.attacking) {
      const ids = army.filter((u) => Math.hypot(u.x - hqc.x, u.y - hqc.y) < 30 && u.order.type !== 'attack').map((u) => u.id);
      if (ids.length) issue(world, { t: 'move', team: this.team, ids, x: threat.x, y: threat.y, attack: true });
      return;
    }

    const minutes = world.tick / TICK_RATE / 60;
    const needed = this.profile.attackAt + this.profile.attackGrowth * minutes;

    // Air raids on harvesters.
    const darts = army.filter((u) => u.kind === 'dart' && u.order.type === 'idle');
    if (!this.attacking && darts.length >= 4 && world.tick - this.lastRaid > TICK_RATE * 40) {
      const enemyHq = world.map.starts[this.team === 0 ? 1 : 0];
      const field = nearestCrystal(world, enemyHq.tx + 1.5, enemyHq.ty + 1.5);
      if (field) {
        this.lastRaid = world.tick;
        issue(world, { t: 'move', team: this.team, ids: darts.map((d) => d.id), x: field.tx + 0.5, y: field.ty + 0.5, attack: true });
      }
    }

    if (!this.attacking && value >= needed) {
      this.attacking = true;
      this.launchedWith = value;
      this.lastPush = -9999;
    }
    if (this.attacking) {
      if (this.level.retreats && value < this.launchedWith * 0.35) {
        this.attacking = false;
        const rally = { x: hqc.x + (world.map.width / 2 - hqc.x) * 0.25, y: hqc.y + (world.map.height / 2 - hqc.y) * 0.25 };
        issue(world, { t: 'move', team: this.team, ids: army.map((u) => u.id), x: rally.x, y: rally.y });
        return;
      }
      if (world.tick - this.lastPush > TICK_RATE * 6) {
        this.lastPush = world.tick;
        const target = this.attackTarget(world, army);
        const ids = army.filter((u) => u.order.type !== 'attack').map((u) => u.id);
        if (ids.length) issue(world, { t: 'move', team: this.team, ids, x: target.x, y: target.y, attack: true });
      }
    }
  }

  private attackTarget(world: World, army: Unit[]): { x: number; y: number } {
    const cx = army.reduce((s, u) => s + u.x, 0) / army.length;
    const cy = army.reduce((s, u) => s + u.y, 0) / army.length;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const b of this.enemyBuildings.values()) {
      // Prefer production and the HQ over turrets.
      const d = Math.hypot(b.x - cx, b.y - cy) + (b.kind === 'turret' ? 10 : 0);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) return best;
    const s = world.map.starts[this.team === 0 ? 1 : 0];
    return { x: s.tx + 1.5, y: s.ty + 1.5 };
  }
}
