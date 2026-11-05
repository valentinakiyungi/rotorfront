# Rotorfront

A mobile-first real-time strategy game for the browser, in the Command & Conquer tradition. Two armies of drones and robot tanks fight over crystal fields. Mine scrap, build a base, out-think an AI commander, and destroy the enemy HQ.

Inspired by [simonw/battledrones](https://github.com/simonw/battledrones). The code, units and art here are original.

## Play

```
npm install
npm run dev        # open the printed URL; the "Network" one works on your phone on the same Wi-Fi
```

- **Touch:** tap to select, tap the map to move, tap an enemy to attack. Long-press then drag to box-select. Double-tap a unit to select every one of that type on screen. Pinch to zoom, drag to pan.
- **Mouse/keyboard:** click or drag to select, right-click to order. `Q` attack-move, `X` stop, `Space` select army, `H` jump home, `Esc` deselect, `P` pause, `WASD`/arrows pan, scroll to zoom.
- **Building:** tap a building in the bottom row. A ghost appears on a good spot; tap the map to move it, tap it (or ✓ Build) to place it.

## What's in it

- **7 units** in a counter web: Mule harvester, Skiff light tank, Ram heavy tank, Thistle flak walker, Howler artillery (slow, dodgeable shells), Dart strike drone, Kestrel interceptor.
- **5 buildings:** HQ, Foundry, Aerie, Depot (forward drop-off), Turret (hits ground and air).
- **3 procedurally generated, perfectly symmetric maps:** Proving Field, Twin Fords (river with crossings), Badlands (mesas and choke points).
- Terrain that matters: roads are fast, woods slow tanks but give 20% cover, rock and water block ground units, aircraft fly over everything.
- Fog of war with remembered enemy buildings; veterancy ranks (★, ★★); armour classes and damage types.
- An **AI commander** with 4 personalities (Balanced, Rush, Air Swarm, Ironclad) and 3 difficulties. It only issues the same commands you can, and only reacts to what its side can see.
- **Watch mode:** AI vs AI at up to 4×.
- After-action report with an army-value timeline. Synthesised sound, no audio files. Installable as a PWA.

## Commands

```
npm run dev          # Vite dev server
npm run build        # typecheck + production build into dist/
npm run preview      # serve the production build
npm test             # simulation tests (node's built-in test runner)
npm run match        # headless AI-vs-AI round robin on every map: the balance harness
npm run match -- fords 4 rush air   # one map, 4 seeds, two personalities
```

## Architecture

The same split battledrones uses: a deterministic simulation that knows nothing about the screen, and a client that draws it and turns input into commands.

- `src/sim/` — pure TypeScript, no DOM. Fixed 10 Hz tick, seeded RNG, command queue. A match is fully described by its seed plus its command log (`world.log`), and the tests prove a replay from the log alone reproduces it exactly. All tunable numbers live in `src/sim/balance.ts`; maps in `src/sim/maps.ts`; the AI in `src/sim/ai/commander.ts`.
- `src/game/` — the Canvas 2D renderer (interpolated between ticks), camera, gesture recognition, effects and synthesised audio.
- `src/ui/` — DOM HUD, menu, pause and end screens.
- `tests/` — simulation tests. `tools/match.ts` — headless AI-vs-AI harness.

See [DESIGN.md](DESIGN.md) for the design and the roadmap.

## Deploying

`.github/workflows/pages.yml` builds and publishes to GitHub Pages on every push to `main`. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
