// Seeded random numbers. The simulation must never call Math.random:
// the same seed and the same commands always produce the same match.

/** mulberry32 step: returns [value in 0..1, next state]. */
export function mulberry32(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** A small stateful RNG for code outside the world (map generation). */
export class Rng {
  constructor(private state: number) {}
  next(): number {
    const [v, s] = mulberry32(this.state);
    this.state = s;
    return v;
  }
  int(lo: number, hiExclusive: number): number {
    return lo + Math.floor(this.next() * (hiExclusive - lo));
  }
}

export function worldRandom(world: { rngState: number }): number {
  const [v, s] = mulberry32(world.rngState);
  world.rngState = s;
  return v;
}
