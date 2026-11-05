// Procedural, 180°-rotationally-symmetric maps: each side gets exactly the same ground.
import { Rng } from './rng';
import { Terrain, type GameMap, type TerrainId } from './types';

export interface MapInfo {
  id: string;
  name: string;
  blurb: string;
  build: () => GameMap;
}

type Painter = {
  w: number;
  h: number;
  rng: Rng;
  get(x: number, y: number): TerrainId;
  /** Sets a tile and its mirror. */
  set(x: number, y: number, t: TerrainId): void;
  inBounds(x: number, y: number): boolean;
};

function valueNoise(rng: Rng, w: number, h: number, cell: number): (x: number, y: number) => number {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = new Float64Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = smooth(fx - ix), ty = smooth(fy - iy);
    const a = g[iy * gw + ix], b = g[iy * gw + ix + 1];
    const c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

function line(p: Painter, x0: number, y0: number, x1: number, y1: number, width: number, t: TerrainId, only?: (cur: TerrainId) => boolean) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    for (let dy = -width; dy <= width; dy++)
      for (let dx = -width; dx <= width; dx++) {
        if (dx * dx + dy * dy > width * width + 0.5) continue;
        const tx = Math.round(x + dx), ty = Math.round(y + dy);
        if (p.inBounds(tx, ty) && (!only || only(p.get(tx, ty)))) p.set(tx, ty, t);
      }
  }
}

const groundPassable = (t: number) => t === Terrain.Grass || t === Terrain.Road || t === Terrain.Woods;

function connected(tiles: Uint8Array, w: number, h: number, a: [number, number], b: [number, number]): boolean {
  const seen = new Uint8Array(w * h);
  const q = [a[1] * w + a[0]];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    if (i === b[1] * w + b[0]) return true;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!seen[j] && groundPassable(tiles[j])) { seen[j] = 1; q.push(j); }
    }
  }
  return false;
}

interface Spec {
  name: string;
  w: number;
  h: number;
  seed: number;
  paint: (p: Painter) => void;
  /** Crystal field centres for the blue side; red gets the mirror. */
  fields: { x: number; y: number; n: number; rich?: boolean }[];
}

function generate(spec: Spec): GameMap {
  const { w, h } = spec;
  const tiles = new Uint8Array(w * h);
  const rng = new Rng(spec.seed);
  const mirror = (x: number, y: number): [number, number] => [w - 1 - x, h - 1 - y];
  const p: Painter = {
    w, h, rng,
    get: (x, y) => tiles[y * w + x] as TerrainId,
    set: (x, y, t) => {
      tiles[y * w + x] = t;
      const [mx, my] = mirror(x, y);
      tiles[my * w + mx] = t;
    },
    inBounds: (x, y) => x >= 0 && y >= 0 && x < w && y < h,
  };
  spec.paint(p);

  const blue = { tx: 4, ty: h - 7 };
  const red = { tx: w - 3 - blue.tx, ty: h - 3 - blue.ty };
  const hqCentre = (s: { tx: number; ty: number }): [number, number] => [s.tx + 1, s.ty + 1];

  // Main road: blue HQ -> centre (the mirror carves centre -> red HQ).
  const [bx, by] = hqCentre(blue);
  line(p, bx, by, w / 2 - 0.5, h / 2 - 0.5, 0, Terrain.Road);

  // Clear the base area.
  for (let y = blue.ty - 3; y < blue.ty + 6; y++)
    for (let x = blue.tx - 3; x < blue.tx + 9; x++)
      if (p.inBounds(x, y) && p.get(x, y) !== Terrain.Road) p.set(x, y, Terrain.Grass);

  // Crystal fields.
  const crystals: GameMap['crystals'] = [];
  const taken = new Set<number>();
  for (const f of spec.fields) {
    const cells: [number, number][] = [];
    for (let r = 0; r <= 3 && cells.length < f.n; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || cells.length >= f.n) continue;
          if (r > 0 && rng.next() < 0.3) continue;
          const x = f.x + dx, y = f.y + dy;
          if (!p.inBounds(x, y) || taken.has(y * w + x)) continue;
          cells.push([x, y]);
        }
    for (const [x, y] of cells) {
      const [mx, my] = mirror(x, y);
      if (taken.has(y * w + x) || taken.has(my * w + mx)) continue;
      taken.add(y * w + x).add(my * w + mx);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (p.inBounds(x + dx, y + dy) && !groundPassable(p.get(x + dx, y + dy))) p.set(x + dx, y + dy, Terrain.Grass);
      if (p.get(x, y) === Terrain.Woods) p.set(x, y, Terrain.Grass);
      crystals.push({ tx: x, ty: y, rich: !!f.rich });
      if (mx !== x || my !== y) crystals.push({ tx: mx, ty: my, rich: !!f.rich });
    }
  }

  // Guarantee the bases connect by ground.
  const [rx, ry] = hqCentre(red);
  if (!connected(tiles, w, h, [bx, by + 2], [rx, ry - 2])) {
    line(p, bx, by, w / 2 - 0.5, h / 2 - 0.5, 1, Terrain.Road);
  }

  return { name: spec.name, width: w, height: h, tiles, starts: [blue, red], crystals };
}

export const MAPS: MapInfo[] = [
  {
    id: 'proving',
    name: 'Proving Field',
    blurb: 'Small and open. Fast games, nowhere to hide.',
    build: () =>
      generate({
        name: 'Proving Field', w: 44, h: 44, seed: 11,
        paint: (p) => {
          const n = valueNoise(p.rng, p.w, p.h, 6);
          for (let y = 0; y < p.h; y++)
            for (let x = 0; x < p.w; x++) {
              if (y * p.w + x > (p.h - 1 - y) * p.w + (p.w - 1 - x)) continue;
              const v = n(x, y);
              p.set(x, y, v > 0.78 ? Terrain.Rock : v > 0.62 ? Terrain.Woods : Terrain.Grass);
            }
        },
        fields: [
          { x: 11, y: 37, n: 8 },
          { x: 6, y: 27, n: 7 },
          { x: 19, y: 25, n: 6, rich: true },
        ],
      }),
  },
  {
    id: 'fords',
    name: 'Twin Fords',
    blurb: 'A river splits the map. Hold the crossings, or fly over them.',
    build: () =>
      generate({
        name: 'Twin Fords', w: 56, h: 56, seed: 23,
        paint: (p) => {
          const n = valueNoise(p.rng, p.w, p.h, 5);
          for (let y = 0; y < p.h; y++)
            for (let x = 0; x < p.w; x++) {
              if (y * p.w + x > (p.h - 1 - y) * p.w + (p.w - 1 - x)) continue;
              p.set(x, y, n(x, y) > 0.66 ? Terrain.Woods : Terrain.Grass);
            }
          // The river follows the main diagonal and meanders.
          for (let i = 0; i <= p.w; i++) {
            const t = i / p.w;
            const off = Math.sin(t * Math.PI * 3) * 3;
            const cx = i + off, cy = i - off;
            for (let d = -1.6; d <= 1.6; d += 0.5) {
              const x = Math.round(cx + d), y = Math.round(cy - d);
              if (p.inBounds(x, y)) p.set(x, y, Terrain.Water);
            }
          }
          // Two outer fords (mirrored) plus the centre crossing the main road makes.
          for (const t of [0.24, 0.5]) {
            const i = Math.round(t * p.w);
            const off = Math.sin(t * Math.PI * 3) * 3;
            line(p, i + off - 3, i - off + 3, i + off + 3, i - off - 3, 1, Terrain.Road, (c) => c === Terrain.Water);
          }
        },
        fields: [
          { x: 12, y: 49, n: 8 },
          { x: 5, y: 36, n: 7 },
          { x: 22, y: 42, n: 7 },
          { x: 21, y: 30, n: 6, rich: true },
        ],
      }),
  },
  {
    id: 'badlands',
    name: 'Badlands',
    blurb: 'Rock mesas and choke points. Big, slow, artillery country.',
    build: () =>
      generate({
        name: 'Badlands', w: 64, h: 64, seed: 37,
        paint: (p) => {
          const n = valueNoise(p.rng, p.w, p.h, 7);
          const m = valueNoise(p.rng, p.w, p.h, 4);
          for (let y = 0; y < p.h; y++)
            for (let x = 0; x < p.w; x++) {
              if (y * p.w + x > (p.h - 1 - y) * p.w + (p.w - 1 - x)) continue;
              const v = n(x, y), u = m(x, y);
              p.set(x, y, v > 0.7 ? Terrain.Rock : v < 0.17 ? Terrain.Water : u > 0.72 ? Terrain.Woods : Terrain.Grass);
            }
        },
        fields: [
          { x: 12, y: 57, n: 8 },
          { x: 4, y: 44, n: 7 },
          { x: 24, y: 50, n: 7 },
          { x: 27, y: 35, n: 7, rich: true },
        ],
      }),
  },
];

export function getMap(id: string): GameMap {
  return (MAPS.find((m) => m.id === id) ?? MAPS[0]).build();
}
