// A* pathfinding for ground units on the tile grid (8-way, no corner cutting),
// followed by string-pulling so units drive in straight lines where they can.
import { Terrain, type World } from './types';
import { groundPassable, inMap } from './world';

const MAX_EXPANSIONS = 9000;
const SQRT2 = Math.SQRT2;

function tileCost(world: World, tx: number, ty: number): number {
  const t = world.map.tiles[ty * world.map.width + tx];
  return t === Terrain.Road ? 0.75 : t === Terrain.Woods ? 1.6 : 1;
}

class Heap {
  items: number[] = [];
  constructor(private f: Float64Array) {}
  push(i: number) {
    const a = this.items, f = this.f;
    a.push(i);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (f[a[p]] <= f[a[c]]) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
    }
  }
  pop(): number {
    const a = this.items, f = this.f;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < a.length && f[a[l]] < f[a[m]]) m = l;
        if (r < a.length && f[a[r]] < f[a[m]]) m = r;
        if (m === c) break;
        [a[m], a[c]] = [a[c], a[m]];
        c = m;
      }
    }
    return top;
  }
  get size() { return this.items.length; }
}

/**
 * Path from (sx,sy) to (gx,gy) in world coordinates. Returns waypoints (tile centres,
 * ending at the exact goal), or a path to the closest reachable tile if the goal is blocked.
 */
export function findPath(world: World, sx: number, sy: number, gx: number, gy: number): { x: number; y: number }[] {
  const w = world.map.width, h = world.map.height;
  const start = Math.floor(sy) * w + Math.floor(sx);
  let gtx = Math.floor(gx), gty = Math.floor(gy);
  if (!inMap(world, gtx, gty)) {
    gtx = Math.max(0, Math.min(w - 1, gtx));
    gty = Math.max(0, Math.min(h - 1, gty));
  }
  const goal = gty * w + gtx;
  if (start === goal) return [{ x: gx, y: gy }];

  const g = new Float64Array(w * h).fill(Infinity);
  const f = new Float64Array(w * h).fill(Infinity);
  const from = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const hfun = (i: number) => {
    const dx = Math.abs((i % w) - gtx), dy = Math.abs(((i / w) | 0) - gty);
    return 0.75 * (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy));
  };
  const heap = new Heap(f);
  g[start] = 0;
  f[start] = hfun(start);
  heap.push(start);
  let best = start, bestH = hfun(start), expansions = 0;

  while (heap.size && expansions < MAX_EXPANSIONS) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expansions++;
    if (cur === goal) { best = cur; break; }
    const ch = hfun(cur);
    if (ch < bestH) { bestH = ch; best = cur; }
    const cx = cur % w, cy = (cur / w) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni] || !groundPassable(world, nx, ny)) continue;
        if (dx && dy && (!groundPassable(world, cx + dx, cy) || !groundPassable(world, cx, cy + dy))) continue;
        const step = (dx && dy ? SQRT2 : 1) * tileCost(world, nx, ny);
        const ng = g[cur] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          f[ni] = ng + hfun(ni);
          from[ni] = cur;
          heap.push(ni);
        }
      }
  }

  const tilesPath: number[] = [];
  for (let i = best; i !== -1 && i !== start; i = from[i]) tilesPath.push(i);
  tilesPath.reverse();
  const pts = tilesPath.map((i) => ({ x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5 }));
  if (best === goal) {
    if (pts.length) pts[pts.length - 1] = { x: gx, y: gy };
    else pts.push({ x: gx, y: gy });
  }
  return smooth(world, sx, sy, pts);
}

/** Walkable straight line between two points, with a little clearance. */
export function lineClear(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len / 0.25));
  const nx = len ? -(y1 - y0) / len : 0, ny = len ? (x1 - x0) / len : 0;
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
    for (const o of [0, 0.32, -0.32]) {
      const px = Math.floor(x + nx * o), py = Math.floor(y + ny * o);
      if (!groundPassable(world, px, py)) return false;
      // Don't cut across woods when a road would be faster: keep woods detours honest.
    }
  }
  return true;
}

function smooth(world: World, sx: number, sy: number, pts: { x: number; y: number }[]) {
  if (pts.length <= 1) return pts;
  const out: { x: number; y: number }[] = [];
  let ax = sx, ay = sy, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    // Look ahead at most 12 waypoints for the furthest one in a straight line.
    j = Math.min(j, i + 12);
    while (j > i && !lineClear(world, ax, ay, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    ax = pts[j].x;
    ay = pts[j].y;
    i = j + 1;
  }
  return out;
}
