// A cheap fingerprint of the world, used to prove two runs stayed in lockstep.
import type { World } from './types';

export function worldHash(world: World): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= Math.round(n * 1000) | 0;
    h = Math.imul(h, 0x01000193);
  };
  mix(world.tick);
  mix(world.teams[0].scrap);
  mix(world.teams[1].scrap);
  for (const u of world.units) { mix(u.id); mix(u.x); mix(u.y); mix(u.hp); }
  for (const b of world.buildings) { mix(b.id); mix(b.hp); mix(b.queue.length); }
  for (const c of world.crystals) mix(c.amount);
  return (h >>> 0).toString(16).padStart(8, '0');
}
