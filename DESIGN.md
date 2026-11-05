# Rotorfront design

## Pillars

1. **Phone first.** Every action works with one thumb. Big buttons, a placement ghost that picks a good spot for you, no hover-only information.
2. **Readable counters.** Every unit has a clear job and a clear weakness. A player who watches one AI-vs-AI game should be able to guess the counters.
3. **Deterministic simulation.** The sim never touches the DOM, the clock or `Math.random`. That gives replays, lockstep multiplayer and headless balance testing for free.

## Economy

- Each side starts with 700 scrap, an HQ, two Mules and two Skiffs.
- Mules carry 100 scrap, mine 8/s (rich purple crystals 1.5×), and unload at an HQ or Depot.
- Crystal tiles hold 500 (rich: 900) and disappear when mined out, pushing players toward the middle.

## Counter web

| Unit | Good against | Weak against |
|---|---|---|
| Skiff (light tank, fast) | Howler, Thistle, Mules | Ram, Dart |
| Ram (heavy tank) | Skiff, buildings | Dart, Howler |
| Thistle (flak walker, air-only) | Dart, Kestrel | Anything on the ground |
| Howler (artillery, min range) | Clumps, Turrets, buildings | Skiff, Dart |
| Dart (strike drone) | Ram, Howler, Mules | Thistle, Kestrel, Turret |
| Kestrel (interceptor, air-only) | Dart | Anything on the ground |

Damage multipliers by damage type × armour class are in `DAMAGE_TABLE` in `src/sim/balance.ts`.

## AI

The Commander thinks every 5–30 ticks depending on difficulty. Each think it:

1. keeps its harvester count at target and puts idle Mules back to work,
2. follows its personality's build order (jumping a Turret ahead if drones are raiding),
3. trains units weighted by personality and by the enemy mix it has *seen*,
4. defends anything near its buildings, raids enemy Mules with Darts, and attacks once its army value passes a threshold that grows with time; on Normal and Hard it retreats when an attack has lost 65% of its value.

## Balance status

`npm run match -- all 2` on the current numbers: every game is decided, median ~5.5 minutes. Ironclad and Balanced win too often, Rush almost never does — Rush trades economy for an early push that doesn't yet hurt enough. That's the first tuning job.

## Roadmap

- **Balance:** make Rush viable (cheaper Foundry? faster Skiff build?), give the HQ a small gun for early defence.
- **Control groups:** hold-to-save squad chips, like battledrones' three thumb chips.
- **Off-screen fight arrows** at the screen edge, and a minimap ping for attacks.
- **Replays:** save `seed + world.log` as JSON and add `?replay=` to watch it.
- **Agent battles:** a text view of each side's fog-limited world plus a JSON order format, so LLMs can play each other (battledrones' `AGENT-BATTLES.md` is the model).
- **Lockstep multiplayer:** the sim is already deterministic; exchange command lists per tick over WebRTC.
- **Service worker** for offline play; more maps; a campaign of short missions.
- **3D renderer** (three.js) as a drop-in replacement for `src/game/render.ts`: the sim doesn't change.
