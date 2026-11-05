// Headless AI-vs-AI matches: the balance harness.
//   npm run match                         # every personality pairing on every map, 1 seed
//   npm run match -- fords 4              # one map, 4 seeds
//   npm run match -- all 2 rush air       # only these two personalities
import { Commander, MAPS, PERSONALITIES, TICK_RATE, createWorld, getMap, step, type Personality } from '../src/sim';

const [mapArg = 'all', seedsArg = '1', ...only] = process.argv.slice(2);
const maps = mapArg === 'all' ? MAPS.map((m) => m.id) : [mapArg];
const seeds = Number(seedsArg) || 1;
const names = (only.length ? only : Object.keys(PERSONALITIES)) as Personality[];
const LIMIT = TICK_RATE * 60 * 25; // 25 minutes

const wins: Record<string, { w: number; l: number; d: number }> = {};
const rec = (p: string) => (wins[p] ??= { w: 0, l: 0, d: 0 });
const lengths: number[] = [];

for (const mapId of maps) {
  for (let s = 1; s <= seeds; s++) {
    for (const blue of names)
      for (const red of names) {
        if (blue === red && names.length > 1) continue;
        const world = createWorld(getMap(mapId), s);
        const ais = [new Commander(0, blue, 'normal', s), new Commander(1, red, 'normal', s)];
        const t0 = performance.now();
        while (world.winner === null && world.tick < LIMIT) {
          for (const ai of ais) ai.think(world);
          step(world);
        }
        const mins = world.tick / TICK_RATE / 60;
        const ms = performance.now() - t0;
        const result = world.winner === null ? 'timeout' : world.winner === 'draw' ? 'draw' : world.winner === 0 ? `blue (${blue})` : `red (${red})`;
        console.log(
          `${mapId.padEnd(9)} seed ${s}  ${blue.padEnd(8)} vs ${red.padEnd(8)}  → ${result.padEnd(16)} ${mins.toFixed(1)} min` +
            `  harvested ${world.teams[0].stats.harvested}/${world.teams[1].stats.harvested}` +
            `  built ${world.teams[0].stats.unitsBuilt}/${world.teams[1].stats.unitsBuilt}  (${(ms / 1000).toFixed(1)}s)`,
        );
        if (world.winner === 0) { rec(blue).w++; rec(red).l++; }
        else if (world.winner === 1) { rec(red).w++; rec(blue).l++; }
        else { rec(blue).d++; rec(red).d++; }
        if (world.winner !== null) lengths.push(mins);
      }
  }
}
console.log('\nPersonality   W   L   D/timeout');
for (const [p, r] of Object.entries(wins)) console.log(`${p.padEnd(12)} ${String(r.w).padStart(3)} ${String(r.l).padStart(3)} ${String(r.d).padStart(3)}`);
if (lengths.length) {
  lengths.sort((a, b) => a - b);
  console.log(`Median decided game: ${lengths[Math.floor(lengths.length / 2)].toFixed(1)} min`);
}
