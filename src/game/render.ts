// Canvas 2D renderer. Reads the world, never changes it.
import {
  BUILDINGS,
  Terrain,
  UNITS,
  type Building,
  type BuildingKind,
  type GameMap,
  type Team,
  type Unit,
  type UnitKind,
  type World,
} from '../sim';
import { Camera, TILE } from './camera';
import type { Effects } from './effects';
import { CRYSTAL, HULL, HULL_LIGHT, SCRAP, TEAM, TERRAIN_COLORS } from './palette';

export interface Marker { x: number; y: number; age: number; attack: boolean }
export interface Ghost { kind: BuildingKind; tx: number; ty: number; error: string | null }

export interface RenderState {
  world: World;
  camera: Camera;
  /** null = spectator: everything is visible. */
  playerTeam: Team | null;
  selection: Set<number>;
  ghost: Ghost | null;
  markers: Marker[];
  effects: Effects;
  alpha: number;
  time: number;
  box: { x0: number; y0: number; x1: number; y1: number } | null;
}

type Vis = Pick<RenderState, 'world' | 'playerTeam'>;

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function renderTerrain(map: GameMap, px = TILE): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = map.width * px;
  c.height = map.height * px;
  const g = c.getContext('2d')!;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? -1 : map.tiles[y * map.width + x]);
  const pick = <T,>(arr: readonly T[], x: number, y: number, salt = 0) => arr[Math.floor(hash(x + salt * 97, y - salt * 31) * arr.length)];

  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const t = at(x, y);
      const X = x * px, Y = y * px;
      g.fillStyle = t === Terrain.Road ? pick(TERRAIN_COLORS.road, x, y)
        : t === Terrain.Water ? pick(TERRAIN_COLORS.water, x, y)
        : t === Terrain.Rock ? pick(TERRAIN_COLORS.rock, x, y)
        : t === Terrain.Woods ? TERRAIN_COLORS.woods
        : pick(TERRAIN_COLORS.grass, x, y);
      g.fillRect(X, Y, px, px);
      if (t === Terrain.Grass) {
        // tufts
        g.fillStyle = 'rgba(120,150,80,0.25)';
        for (let i = 0; i < 3; i++) g.fillRect(X + hash(x, y + i) * px, Y + hash(x + i, y) * px, 2, 2);
      }
    }
  // Road edges and water shimmer, rock rims, then trees on top.
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const t = at(x, y);
      const X = x * px, Y = y * px;
      if (t === Terrain.Water) {
        g.strokeStyle = TERRAIN_COLORS.waterHi;
        g.globalAlpha = 0.35;
        g.lineWidth = 1.5;
        g.beginPath();
        const oy = hash(x, y) * px * 0.7 + 4;
        g.moveTo(X + 4, Y + oy);
        g.quadraticCurveTo(X + px / 2, Y + oy - 3, X + px - 4, Y + oy);
        g.stroke();
        g.globalAlpha = 1;
        // shoreline
        g.fillStyle = 'rgba(200,190,140,0.35)';
        if (at(x, y - 1) !== Terrain.Water && at(x, y - 1) >= 0) g.fillRect(X, Y, px, 3);
        if (at(x, y + 1) !== Terrain.Water && at(x, y + 1) >= 0) g.fillRect(X, Y + px - 3, px, 3);
        if (at(x - 1, y) !== Terrain.Water && at(x - 1, y) >= 0) g.fillRect(X, Y, 3, px);
        if (at(x + 1, y) !== Terrain.Water && at(x + 1, y) >= 0) g.fillRect(X + px - 3, Y, 3, px);
      }
      if (t === Terrain.Rock) {
        g.fillStyle = 'rgba(255,255,255,0.07)';
        g.beginPath();
        g.moveTo(X + px * 0.2, Y + px * 0.8);
        g.lineTo(X + px * (0.4 + hash(x, y) * 0.3), Y + px * 0.2);
        g.lineTo(X + px * 0.85, Y + px * 0.7);
        g.fill();
        g.fillStyle = TERRAIN_COLORS.rockEdge;
        if (at(x, y + 1) !== Terrain.Rock) g.fillRect(X, Y + px - 5, px, 5);
        if (at(x + 1, y) !== Terrain.Rock) g.fillRect(X + px - 3, Y, 3, px);
      }
      if (t === Terrain.Road) {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(X + px * 0.48, Y + px * 0.2, 1.5, px * 0.25);
      }
    }
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (at(x, y) !== Terrain.Woods) continue;
      for (let i = 0; i < 3; i++) {
        const cx = x * px + (0.2 + hash(x + i, y) * 0.6) * px;
        const cy = y * px + (0.2 + hash(x, y + i * 7) * 0.6) * px;
        const r = px * (0.2 + hash(x * 3 + i, y) * 0.12);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath(); g.ellipse(cx + 2, cy + 3, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = pick(TERRAIN_COLORS.tree, x, y, i);
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.beginPath(); g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.45, 0, Math.PI * 2); g.fill();
      }
    }
  return c;
}

// ------------------------------------------------------------------ sprites (drawn in tile units)

function drawUnitShape(g: CanvasRenderingContext2D, kind: UnitKind, team: Team, time: number, cargo: number, moving: boolean) {
  const tc = TEAM[team];
  g.lineJoin = 'round';
  g.lineWidth = 0.05;
  g.strokeStyle = 'rgba(0,0,0,0.65)';
  const poly = (pts: number[], fill: string) => {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.stroke();
  };
  const rect = (x: number, y: number, w: number, h: number, fill: string) => {
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
    g.strokeRect(x, y, w, h);
  };
  const circle = (x: number, y: number, r: number, fill: string) => {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.stroke();
  };
  const treads = (len: number, half: number, w: number) => {
    rect(-len / 2, -half, len, w, '#222');
    rect(-len / 2, half - w, len, w, '#222');
    if (moving) {
      g.strokeStyle = '#555';
      const off = ((time / 60) % 4) * (len / 12);
      for (let x = -len / 2 + off; x < len / 2; x += len / 3) {
        g.beginPath(); g.moveTo(x, -half); g.lineTo(x, -half + w); g.moveTo(x, half - w); g.lineTo(x, half); g.stroke();
      }
      g.strokeStyle = 'rgba(0,0,0,0.65)';
    }
  };

  switch (kind) {
    case 'mule':
      treads(0.86, 0.36, 0.12);
      rect(-0.42, -0.26, 0.84, 0.52, HULL);
      rect(0.14, -0.22, 0.26, 0.44, tc.main);
      rect(-0.38, -0.2, 0.46, 0.4, '#1d2126');
      if (cargo > 0) {
        g.fillStyle = CRYSTAL.main;
        g.fillRect(-0.36, -0.18, 0.42 * cargo, 0.36);
      }
      break;
    case 'skiff':
      poly([0.44, 0, 0.14, 0.3, -0.36, 0.3, -0.36, -0.3, 0.14, -0.3], HULL);
      poly([0.3, 0, 0.1, 0.16, -0.28, 0.16, -0.28, -0.16, 0.1, -0.16], tc.main);
      rect(0.05, -0.04, 0.45, 0.08, HULL_LIGHT);
      circle(0, 0, 0.12, tc.dark);
      break;
    case 'ram':
      treads(1.0, 0.48, 0.18);
      rect(-0.45, -0.32, 0.9, 0.64, HULL);
      rect(-0.35, -0.24, 0.5, 0.48, tc.main);
      rect(0.05, -0.06, 0.72, 0.12, HULL_LIGHT);
      circle(0, 0, 0.23, tc.dark);
      circle(0, 0, 0.1, HULL_LIGHT);
      break;
    case 'thistle': {
      const step = moving ? Math.sin(time / 90) * 0.08 : 0;
      g.strokeStyle = '#222';
      g.lineWidth = 0.09;
      for (const [sx, sy, ph] of [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]) {
        g.beginPath(); g.moveTo(0, 0); g.lineTo(sx * (0.36 + step * ph), sy * 0.36); g.stroke();
      }
      g.lineWidth = 0.05;
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      circle(0, 0, 0.26, tc.main);
      rect(0.05, -0.17, 0.42, 0.08, HULL_LIGHT);
      rect(0.05, 0.09, 0.42, 0.08, HULL_LIGHT);
      circle(-0.02, 0, 0.12, HULL);
      break;
    }
    case 'howler':
      treads(0.9, 0.36, 0.12);
      rect(-0.42, -0.26, 0.84, 0.52, HULL);
      rect(-0.38, -0.22, 0.3, 0.44, tc.main);
      rect(-0.12, -0.05, 0.95, 0.1, HULL_LIGHT);
      rect(-0.14, -0.14, 0.3, 0.28, tc.dark);
      break;
    case 'dart': {
      poly([0.38, 0, 0, 0.14, -0.3, 0.08, -0.3, -0.08, 0, -0.14], tc.main);
      for (const sy of [-0.3, 0.3]) {
        g.fillStyle = 'rgba(20,20,20,0.6)';
        g.beginPath(); g.arc(-0.05, sy, 0.17, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#ddd';
        g.lineWidth = 0.035;
        const a = time / 25 + sy;
        g.beginPath();
        g.moveTo(-0.05 + Math.cos(a) * 0.17, sy + Math.sin(a) * 0.17);
        g.lineTo(-0.05 - Math.cos(a) * 0.17, sy - Math.sin(a) * 0.17);
        g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.65)';
        g.lineWidth = 0.05;
        g.beginPath(); g.moveTo(-0.05, 0); g.lineTo(-0.05, sy); g.stroke();
      }
      circle(0.12, 0, 0.06, '#ffe28a');
      break;
    }
    case 'kestrel':
      poly([0.5, 0, -0.32, 0.4, -0.18, 0, -0.32, -0.4], tc.main);
      poly([0.38, 0, -0.1, 0.1, -0.1, -0.1], HULL);
      g.fillStyle = `rgba(150,220,255,${0.5 + Math.sin(time / 50) * 0.3})`;
      g.beginPath(); g.arc(-0.24, 0, 0.07, 0, Math.PI * 2); g.fill();
      break;
  }
}

function drawBuildingShape(g: CanvasRenderingContext2D, b: Building, time: number, aimAngle: number | null) {
  const tc = TEAM[b.team];
  const s = b.size;
  g.lineWidth = 0.06;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  // slab
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0.12, 0.18, s, s);
  g.fillStyle = '#2b3036';
  g.fillRect(0.04, 0.04, s - 0.08, s - 0.08);
  g.strokeRect(0.04, 0.04, s - 0.08, s - 0.08);
  g.fillStyle = tc.dark;
  g.fillRect(0.04, s - 0.22, s - 0.08, 0.18);
  const c = s / 2;
  const light = (x: number, y: number) => {
    g.fillStyle = Math.sin(time / 300 + x * 3 + y) > 0 ? '#ffd27a' : '#7a5a2a';
    g.fillRect(x - 0.05, y - 0.05, 0.1, 0.1);
  };
  switch (b.kind) {
    case 'hq':
      g.fillStyle = HULL;
      g.fillRect(0.35, 0.35, s - 0.7, s - 0.7);
      g.strokeRect(0.35, 0.35, s - 0.7, s - 0.7);
      g.beginPath(); g.arc(c, c, 0.85, 0, Math.PI * 2); g.fillStyle = tc.main; g.fill(); g.stroke();
      g.beginPath(); g.arc(c, c, 0.45, 0, Math.PI * 2); g.fillStyle = tc.light; g.fill(); g.stroke();
      g.strokeStyle = '#ccc';
      g.beginPath(); g.moveTo(c + 0.6, c - 0.6); g.lineTo(c + 1.15, c - 1.2); g.stroke();
      light(c + 1.15, c - 1.2);
      light(0.3, 0.3); light(s - 0.3, 0.3); light(0.3, s - 0.3); light(s - 0.3, s - 0.3);
      break;
    case 'foundry':
      for (let i = 0; i < 3; i++) {
        g.fillStyle = i % 2 ? HULL : '#4a525b';
        g.fillRect(0.25 + i * 0.85, 0.25, 0.75, 1.6);
        g.strokeRect(0.25 + i * 0.85, 0.25, 0.75, 1.6);
      }
      g.fillStyle = tc.main;
      g.fillRect(0.9, 1.95, 1.2, 0.75);
      g.strokeRect(0.9, 1.95, 1.2, 0.75);
      g.fillStyle = '#ff9a3c';
      g.globalAlpha = 0.4 + 0.3 * Math.sin(time / 200);
      g.fillRect(1.0, 2.05, 1.0, 0.2);
      g.globalAlpha = 1;
      break;
    case 'aerie':
      g.beginPath(); g.arc(c, c, 1.2, 0, Math.PI * 2); g.fillStyle = '#3a4048'; g.fill(); g.stroke();
      g.strokeStyle = tc.main;
      g.lineWidth = 0.12;
      g.beginPath(); g.arc(c, c, 0.95, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(c - 0.4, c - 0.45); g.lineTo(c - 0.4, c + 0.45); g.moveTo(c + 0.4, c - 0.45); g.lineTo(c + 0.4, c + 0.45);
      g.moveTo(c - 0.4, c); g.lineTo(c + 0.4, c); g.stroke();
      light(0.35, 0.35); light(s - 0.35, s - 0.35);
      break;
    case 'depot':
      g.fillStyle = HULL;
      g.fillRect(0.25, 0.25, 0.7, 0.7); g.strokeRect(0.25, 0.25, 0.7, 0.7);
      g.fillRect(0.25, 1.0, 0.7, 0.6); g.strokeRect(0.25, 1.0, 0.7, 0.6);
      g.beginPath(); g.arc(1.4, 0.75, 0.42, 0, Math.PI * 2); g.fillStyle = tc.main; g.fill(); g.stroke();
      g.beginPath(); g.arc(1.4, 0.75, 0.2, 0, Math.PI * 2); g.fillStyle = CRYSTAL.main; g.fill();
      break;
    case 'turret': {
      g.beginPath(); g.arc(c, c, 0.4, 0, Math.PI * 2); g.fillStyle = HULL; g.fill(); g.stroke();
      const a = aimAngle ?? time / 1500 + b.id;
      g.save();
      g.translate(c, c);
      g.rotate(a);
      g.fillStyle = HULL_LIGHT;
      g.fillRect(0, -0.12, 0.62, 0.08);
      g.fillRect(0, 0.04, 0.62, 0.08);
      g.strokeRect(0, -0.12, 0.62, 0.24);
      g.beginPath(); g.arc(0, 0, 0.24, 0, Math.PI * 2); g.fillStyle = tc.main; g.fill(); g.stroke();
      g.restore();
      break;
    }
  }
}

// ------------------------------------------------------------------ renderer

export class Renderer {
  private terrain: HTMLCanvasElement;
  private fogCanvas: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogData: ImageData;
  private fogTick = -1;
  /** Enemy buildings the player has seen: drawn as ghosts under the fog. */
  memory = new Map<number, { kind: BuildingKind; team: Team; tx: number; ty: number; size: number }>();
  minimapBase: HTMLCanvasElement;

  constructor(private g: CanvasRenderingContext2D, map: GameMap) {
    this.terrain = renderTerrain(map);
    this.minimapBase = renderTerrain(map, 4);
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = map.width;
    this.fogCanvas.height = map.height;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    this.fogData = this.fogCtx.createImageData(map.width, map.height);
  }

  private visibleTile(s: Vis, x: number, y: number): boolean {
    if (s.playerTeam === null) return true;
    const m = s.world.map;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return false;
    return s.world.visible[s.playerTeam][ty * m.width + tx] === 1;
  }

  canSee(s: Vis, e: Unit | Building): boolean {
    if (s.playerTeam === null || e.team === s.playerTeam) return true;
    if ('size' in e) {
      for (let y = e.ty; y < e.ty + e.size; y++) for (let x = e.tx; x < e.tx + e.size; x++) if (this.visibleTile(s, x, y)) return true;
      return false;
    }
    return this.visibleTile(s, e.x, e.y);
  }

  private updateFog(s: RenderState) {
    if (s.playerTeam === null || s.world.tick === this.fogTick) return;
    this.fogTick = s.world.tick;
    const vis = s.world.visible[s.playerTeam], ex = s.world.explored[s.playerTeam];
    const d = this.fogData.data;
    for (let i = 0; i < vis.length; i++) {
      d[i * 4] = 8; d[i * 4 + 1] = 12; d[i * 4 + 2] = 18;
      d[i * 4 + 3] = vis[i] ? 0 : ex[i] ? 130 : 238;
    }
    this.fogCtx.putImageData(this.fogData, 0, 0);
    // Remember enemy buildings we can see; forget ones we see are gone.
    for (const b of s.world.buildings) {
      if (b.team !== s.playerTeam && this.canSee(s, b)) this.memory.set(b.id, { kind: b.kind, team: b.team, tx: b.tx, ty: b.ty, size: b.size });
    }
    for (const [id, m] of this.memory) {
      if (!s.world.byId.has(id) && this.visibleTile(s, m.tx + m.size / 2, m.ty + m.size / 2)) this.memory.delete(id);
    }
  }

  draw(s: RenderState): void {
    const { g } = this;
    const { camera: cam, world } = s;
    const sc = cam.scale;
    this.updateFog(s);

    g.save();
    if (s.effects.shake) g.translate((Math.random() - 0.5) * s.effects.shake, (Math.random() - 0.5) * s.effects.shake);
    g.fillStyle = '#0b0f14';
    g.fillRect(-10, -10, cam.w + 20, cam.h + 20);

    // terrain
    const [ox, oy] = cam.toScreen(0, 0);
    g.imageSmoothingEnabled = cam.zoom < 1;
    g.drawImage(this.terrain, ox, oy, world.map.width * sc, world.map.height * sc);
    g.imageSmoothingEnabled = true;

    const v = cam.view(2);
    const inView = (x: number, y: number) => x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1;
    const lerp = (a: number, b: number) => a + (b - a) * s.alpha;
    const tile = (wx: number, wy: number, fn: () => void) => {
      const [sx, sy] = cam.toScreen(wx, wy);
      g.save(); g.translate(sx, sy); g.scale(sc, sc); fn(); g.restore();
    };

    // crystals
    for (const c of world.crystals) {
      if (!inView(c.tx, c.ty)) continue;
      const full = c.amount / (c.rich ? 900 : 500);
      tile(c.tx, c.ty, () => {
        const n = full > 0.66 ? 3 : full > 0.33 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const cx = 0.3 + hash(c.tx + i, c.ty) * 0.4, cy = 0.35 + hash(c.tx, c.ty + i) * 0.35;
          const r = 0.16 + 0.1 * full;
          g.beginPath();
          g.moveTo(cx, cy - r * 1.5); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath();
          g.fillStyle = c.rich ? CRYSTAL.rich : CRYSTAL.main;
          g.fill();
          g.lineWidth = 0.04; g.strokeStyle = c.rich ? CRYSTAL.richDark : CRYSTAL.dark; g.stroke();
          g.fillStyle = 'rgba(255,255,255,0.55)';
          g.beginPath(); g.moveTo(cx, cy - r * 1.5); g.lineTo(cx + r * 0.4, cy - r * 0.2); g.lineTo(cx, cy); g.closePath(); g.fill();
        }
      });
    }

    // remembered enemy buildings (ghosts)
    if (s.playerTeam !== null) {
      for (const [id, m] of this.memory) {
        const live = world.byId.get(id);
        if (live && this.canSee(s, live)) continue;
        tile(m.tx, m.ty, () => {
          g.globalAlpha = 0.45;
          g.fillStyle = '#2b3036';
          g.fillRect(0.04, 0.04, m.size - 0.08, m.size - 0.08);
          g.strokeStyle = TEAM[m.team].main;
          g.lineWidth = 0.06;
          g.strokeRect(0.04, 0.04, m.size - 0.08, m.size - 0.08);
          g.globalAlpha = 1;
        });
      }
    }

    // buildings
    for (const b of world.buildings) {
      if (!inView(b.tx, b.ty) || !this.canSee(s, b)) continue;
      const def = BUILDINGS[b.kind];
      let aim: number | null = null;
      const t = b.target && world.byId.get(b.target);
      if (t) {
        const tp = 'size' in t ? { x: t.tx + t.size / 2, y: t.ty + t.size / 2 } : { x: t.x, y: t.y };
        aim = Math.atan2(tp.y - (b.ty + b.size / 2), tp.x - (b.tx + b.size / 2));
      }
      tile(b.tx, b.ty, () => {
        if (!b.complete) g.globalAlpha = 0.6;
        drawBuildingShape(g, b, s.time, aim);
        g.globalAlpha = 1;
        if (!b.complete) {
          g.save();
          g.beginPath(); g.rect(0, 0, b.size, b.size); g.clip();
          g.strokeStyle = 'rgba(255,194,74,0.5)'; g.lineWidth = 0.08;
          for (let i = -b.size; i < b.size * 2; i += 0.4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + b.size, b.size); g.stroke(); }
          g.restore();
          bar(g, 0.1, b.size + 0.08, b.size - 0.2, b.progress / (def.buildTime * 10), SCRAP);
        } else if (b.queue.length && (s.playerTeam === null || b.team === s.playerTeam)) {
          bar(g, 0.1, b.size + 0.08, b.size - 0.2, b.prodTicks / (UNITS[b.queue[0]].buildTime * 10), '#9fe6ff');
        }
        if (s.selection.has(b.id)) {
          g.strokeStyle = TEAM[b.team].light; g.lineWidth = 0.07; g.setLineDash([0.25, 0.15]);
          g.strokeRect(-0.1, -0.1, b.size + 0.2, b.size + 0.2);
          g.setLineDash([]);
        }
        if (b.hp < def.hp && b.complete) bar(g, 0.1, -0.25, b.size - 0.2, b.hp / def.hp, hpColor(b.hp / def.hp));
      });
      // rally line
      if (s.selection.has(b.id) && b.rally) {
        const [x0, y0] = cam.toScreen(b.tx + b.size / 2, b.ty + b.size / 2);
        const [x1, y1] = cam.toScreen(b.rally.x, b.rally.y);
        g.strokeStyle = 'rgba(169,212,255,0.6)'; g.lineWidth = 1.5; g.setLineDash([6, 5]);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
        tile(b.rally.x, b.rally.y, () => {
          g.strokeStyle = '#ddd'; g.lineWidth = 0.05;
          g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -0.7); g.stroke();
          g.fillStyle = TEAM[b.team].main; g.beginPath(); g.moveTo(0, -0.7); g.lineTo(0.4, -0.55); g.lineTo(0, -0.4); g.fill();
        });
      }
    }

    // order markers
    for (const m of s.markers) {
      const k = m.age / 600;
      tile(m.x, m.y, () => {
        g.strokeStyle = m.attack ? `rgba(255,93,77,${1 - k})` : `rgba(120,255,160,${1 - k})`;
        g.lineWidth = 0.07;
        g.beginPath(); g.ellipse(0, 0, 0.2 + k * 0.5, (0.2 + k * 0.5) * 0.6, 0, 0, Math.PI * 2); g.stroke();
      });
    }

    const ground: Unit[] = [], air: Unit[] = [];
    for (const u of world.units) {
      const x = lerp(u.px, u.x), y = lerp(u.py, u.y);
      if (!inView(x, y) || !this.canSee(s, u)) continue;
      (UNITS[u.kind].layer === 'air' ? air : ground).push(u);
    }
    const drawUnit = (u: Unit, lift: number) => {
      const def = UNITS[u.kind];
      const x = lerp(u.px, u.x), y = lerp(u.py, u.y);
      const moving = Math.abs(u.x - u.px) + Math.abs(u.y - u.py) > 0.001;
      if (s.selection.has(u.id)) {
        tile(x, y, () => {
          g.strokeStyle = TEAM[u.team].light; g.lineWidth = 0.06;
          g.beginPath(); g.ellipse(0, 0.05, def.radius + 0.18, (def.radius + 0.18) * 0.7, 0, 0, Math.PI * 2); g.stroke();
        });
      }
      tile(x, y - lift, () => {
        g.save();
        g.rotate(u.facing);
        drawUnitShape(g, u.kind, u.team, s.time + u.id * 37, u.cargo / (def.capacity ?? 1), moving);
        g.restore();
        if (u.rank) {
          g.fillStyle = '#ffd27a';
          g.font = 'bold 0.32px system-ui';
          g.textAlign = 'center';
          g.fillText(u.rank > 1 ? '★★' : '★', 0, -def.radius - 0.32);
        }
        if (u.hp < def.hp || s.selection.has(u.id)) bar(g, -0.4, -def.radius - 0.22, 0.8, u.hp / def.hp, hpColor(u.hp / def.hp));
      });
    };
    ground.sort((a, b) => a.y - b.y);
    for (const u of ground) drawUnit(u, 0);

    // projectiles (artillery shells arc)
    for (const p of world.projectiles) {
      const t = (p.age + s.alpha) / p.flight;
      const x = p.sx + (p.tx - p.sx) * t, y = p.sy + (p.ty - p.sy) * t;
      if (!inView(x, y) || !this.visibleTile(s, x, y)) continue;
      const h = Math.sin(Math.PI * Math.min(1, t)) * Math.hypot(p.tx - p.sx, p.ty - p.sy) * 0.25;
      tile(x, y, () => {
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(0, 0, 0.12, 0.07, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffd28a'; g.beginPath(); g.arc(0, -h, 0.1, 0, Math.PI * 2); g.fill();
      });
      // landing warning for shells aimed at the player
      if (s.playerTeam !== null && p.team !== s.playerTeam) {
        tile(p.tx, p.ty, () => {
          g.strokeStyle = `rgba(255,93,77,${0.3 + 0.4 * t})`; g.lineWidth = 0.05;
          g.beginPath(); g.arc(0, 0, Math.max(0.5, p.splash), 0, Math.PI * 2); g.stroke();
        });
      }
    }

    // air: shadows then aircraft
    for (const u of air) {
      const x = lerp(u.px, u.x), y = lerp(u.py, u.y);
      tile(x + 0.25, y + 0.35, () => {
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(0, 0, 0.32, 0.2, 0, 0, Math.PI * 2); g.fill();
      });
    }
    air.sort((a, b) => a.y - b.y);
    for (const u of air) drawUnit(u, 0.55 + Math.sin(s.time / 400 + u.id) * 0.05);

    // effects
    for (const t of s.effects.tracers) {
      const [x0, y0] = cam.toScreen(t.x0, t.y0);
      const [x1, y1] = cam.toScreen(t.x1, t.y1);
      g.strokeStyle = t.color;
      g.globalAlpha = 1 - t.age / t.life;
      g.lineWidth = t.width * Math.max(0.6, cam.zoom);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.globalAlpha = 1;
    for (const p of s.effects.particles) {
      if (!inView(p.x, p.y)) continue;
      const [sx, sy] = cam.toScreen(p.x, p.y);
      const k = p.age / p.life;
      if (p.kind === 'ring') {
        g.strokeStyle = `rgba(255,243,196,${1 - k})`;
        g.lineWidth = 3 * (1 - k) + 0.5;
        g.beginPath(); g.arc(sx, sy, p.size * sc * k, 0, Math.PI * 2); g.stroke();
        continue;
      }
      g.globalAlpha = p.kind === 'smoke' ? 0.5 * (1 - k) : 1 - k;
      g.fillStyle = p.kind === 'fire' ? (k < 0.3 ? '#fff0b0' : k < 0.6 ? '#ffb347' : '#c2412b') : p.color;
      const r = p.size * sc * (p.kind === 'smoke' ? 0.6 + k : 1 - k * 0.5);
      g.beginPath(); g.arc(sx, sy, Math.max(0.8, r), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    // fog of war
    if (s.playerTeam !== null) {
      g.imageSmoothingEnabled = true;
      g.drawImage(this.fogCanvas, ox, oy, world.map.width * sc, world.map.height * sc);
    }
    // map border
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 3;
    g.strokeRect(ox, oy, world.map.width * sc, world.map.height * sc);

    // placement ghost
    if (s.ghost) {
      const def = BUILDINGS[s.ghost.kind];
      const ok = !s.ghost.error;
      tile(s.ghost.tx, s.ghost.ty, () => {
        g.fillStyle = ok ? 'rgba(120,255,160,0.25)' : 'rgba(255,93,77,0.25)';
        g.fillRect(0, 0, def.size, def.size);
        g.strokeStyle = ok ? '#78ffa0' : '#ff5d4d';
        g.lineWidth = 0.08;
        g.setLineDash([0.3, 0.2]);
        g.strokeRect(0, 0, def.size, def.size);
        g.setLineDash([]);
        for (let y = 0; y < def.size; y++) for (let x = 0; x < def.size; x++) {
          g.strokeStyle = 'rgba(255,255,255,0.15)'; g.lineWidth = 0.03; g.strokeRect(x, y, 1, 1);
        }
      });
      const [gx, gy] = cam.toScreen(s.ghost.tx + def.size / 2, s.ghost.ty - 0.3);
      label(g, gx, gy, ok ? `Tap to build ${def.name}` : s.ghost.error!, ok ? '#78ffa0' : '#ff8a7a');
    }

    // floating texts
    for (const t of s.effects.texts) {
      const [sx, sy] = cam.toScreen(t.x, t.y);
      g.globalAlpha = 1 - t.age / t.life;
      g.font = `700 ${Math.round(13 + 3 * cam.zoom)}px ui-monospace, Menlo, monospace`;
      g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(t.text, sx, sy);
      g.fillStyle = t.color;
      g.fillText(t.text, sx, sy);
    }
    g.globalAlpha = 1;

    // drag-select box
    if (s.box) {
      g.strokeStyle = 'rgba(169,212,255,0.9)';
      g.fillStyle = 'rgba(77,163,255,0.12)';
      g.lineWidth = 1;
      const x = Math.min(s.box.x0, s.box.x1), y = Math.min(s.box.y0, s.box.y1);
      g.fillRect(x, y, Math.abs(s.box.x1 - s.box.x0), Math.abs(s.box.y1 - s.box.y0));
      g.strokeRect(x, y, Math.abs(s.box.x1 - s.box.x0), Math.abs(s.box.y1 - s.box.y0));
    }
    g.restore();
  }

  drawMinimap(m: CanvasRenderingContext2D, s: RenderState): void {
    const W = m.canvas.width, H = m.canvas.height;
    const { world } = s;
    const kx = W / world.map.width, ky = H / world.map.height;
    m.imageSmoothingEnabled = true;
    m.drawImage(this.minimapBase, 0, 0, W, H);
    if (s.playerTeam !== null) m.drawImage(this.fogCanvas, 0, 0, W, H);
    m.fillStyle = CRYSTAL.main;
    for (const c of world.crystals) {
      if (s.playerTeam !== null && !world.explored[s.playerTeam][c.ty * world.map.width + c.tx]) continue;
      m.fillRect(c.tx * kx, c.ty * ky, Math.max(1, kx), Math.max(1, ky));
    }
    if (s.playerTeam !== null) {
      for (const [id, g] of this.memory) {
        if (world.byId.has(id) && this.canSee(s, world.byId.get(id)!)) continue;
        m.fillStyle = TEAM[g.team].dark;
        m.fillRect(g.tx * kx, g.ty * ky, g.size * kx, g.size * ky);
      }
    }
    for (const b of world.buildings) {
      if (!this.canSee(s, b)) continue;
      m.fillStyle = TEAM[b.team].main;
      m.fillRect(b.tx * kx, b.ty * ky, b.size * kx, b.size * ky);
      m.strokeStyle = 'rgba(0,0,0,0.6)';
      m.strokeRect(b.tx * kx, b.ty * ky, b.size * kx, b.size * ky);
    }
    for (const u of world.units) {
      if (!this.canSee(s, u)) continue;
      m.fillStyle = s.selection.has(u.id) ? '#fff' : TEAM[u.team].light;
      const r = UNITS[u.kind].layer === 'air' ? 1.5 : 2;
      m.fillRect(u.x * kx - r / 2, u.y * ky - r / 2, r, r);
    }
    const v = s.camera.view(0);
    m.strokeStyle = 'rgba(255,255,255,0.85)';
    m.lineWidth = 1;
    m.strokeRect(v.x0 * kx, v.y0 * ky, (v.x1 - v.x0) * kx, (v.y1 - v.y0) * ky);
  }
}

function hpColor(f: number) {
  return f > 0.6 ? '#78e06a' : f > 0.3 ? '#ffc24a' : '#ff5d4d';
}

function bar(g: CanvasRenderingContext2D, x: number, y: number, w: number, f: number, color: string) {
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillRect(x - 0.03, y - 0.03, w + 0.06, 0.15);
  g.fillStyle = color;
  g.fillRect(x, y, w * Math.max(0, Math.min(1, f)), 0.09);
}

function label(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  g.font = '600 13px system-ui, sans-serif';
  g.textAlign = 'center';
  const w = g.measureText(text).width + 14;
  g.fillStyle = 'rgba(8,12,18,0.85)';
  g.fillRect(x - w / 2, y - 20, w, 22);
  g.fillStyle = color;
  g.fillText(text, x, y - 4);
}

// ------------------------------------------------------------------ icons for the HUD

const iconCache = new Map<string, string>();

export function unitIcon(kind: UnitKind, team: Team, px = 64): string {
  const key = `u${kind}${team}${px}`;
  if (iconCache.has(key)) return iconCache.get(key)!;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  g.translate(px / 2, px / 2);
  g.scale(px * 0.85, px * 0.85);
  g.rotate(-Math.PI / 4);
  drawUnitShape(g, kind, team, 400, kind === 'mule' ? 0.7 : 0, false);
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

export function buildingIcon(kind: BuildingKind, team: Team, px = 64): string {
  const key = `b${kind}${team}${px}`;
  if (iconCache.has(key)) return iconCache.get(key)!;
  const size = BUILDINGS[kind].size;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  const k = (px * 0.86) / size;
  g.translate(px * 0.07, px * 0.05);
  g.scale(k, k);
  const fake = { id: 1, team, kind, tx: 0, ty: 0, size, hp: 1, progress: 0, complete: true, queue: [], prodTicks: 0, rally: null, cooldown: 0, target: 0, lastAttacker: 0 } as Building;
  drawBuildingShape(g, fake, 0, -Math.PI / 4);
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}
