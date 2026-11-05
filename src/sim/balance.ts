// Every tunable number in the game lives here.
import type { Armor, BuildingDef, BuildingKind, DamageType, UnitDef, UnitKind } from './types';

export const TICK_RATE = 10; // simulation ticks per second
export const DT = 1 / TICK_RATE;

export const START_SCRAP = 700;
export const CRYSTAL_AMOUNT = 500;
export const RICH_CRYSTAL_AMOUNT = 900;
/** Scrap mined per second while a harvester sits on a crystal. */
export const MINE_RATE = 8;
export const RICH_MINE_BONUS = 1.5;
export const QUEUE_LIMIT = 5;
/** Build radius around any completed friendly building (tiles, from its centre). */
export const BUILD_RADIUS = 9;
export const FOG_UPDATE_TICKS = 3;
/** Kills needed for each veterancy rank. */
export const RANK_KILLS = [3, 7];
export const RANK_DAMAGE_BONUS = 0.15;

/** Damage multiplier for damage type vs armor class. */
export const DAMAGE_TABLE: Record<DamageType, Record<Armor, number>> = {
  bullet: { light: 1.0, heavy: 0.45, air: 0.6, structure: 0.4 },
  cannon: { light: 0.75, heavy: 1.25, air: 0, structure: 1.0 },
  shell: { light: 1.0, heavy: 0.8, air: 0, structure: 1.5 },
  missile: { light: 1.25, heavy: 1.0, air: 0, structure: 0.8 },
  flak: { light: 0, heavy: 0, air: 1.0, structure: 0 },
  turret: { light: 1.0, heavy: 0.9, air: 0.9, structure: 0 },
};

export const UNITS: Record<UnitKind, UnitDef> = {
  mule: {
    name: 'Mule', role: 'Harvester. Mines crystal and hauls it home.',
    cost: 150, hp: 320, armor: 'heavy', layer: 'ground', speed: 1.8, sight: 5,
    buildTime: 7, builtAt: 'hq', radius: 0.45, capacity: 100,
  },
  skiff: {
    name: 'Skiff', role: 'Fast light tank. Hunts artillery and flak.',
    cost: 100, hp: 190, armor: 'light', layer: 'ground', speed: 3.1, sight: 6,
    buildTime: 5, builtAt: 'foundry', radius: 0.38,
    weapon: { damage: 13, range: 4, cooldown: 0.7, type: 'bullet', hitsGround: true, hitsAir: false },
  },
  ram: {
    name: 'Ram', role: 'Heavy tank. Smashes Skiffs and buildings.',
    cost: 280, hp: 700, armor: 'heavy', layer: 'ground', speed: 1.7, sight: 6,
    buildTime: 10, builtAt: 'foundry', radius: 0.5,
    weapon: { damage: 44, range: 4.5, cooldown: 1.5, type: 'cannon', hitsGround: true, hitsAir: false },
  },
  thistle: {
    name: 'Thistle', role: 'Flak walker. Shreds drones, cannot hit ground.',
    cost: 130, hp: 230, armor: 'light', layer: 'ground', speed: 2.4, sight: 7,
    buildTime: 6, builtAt: 'foundry', radius: 0.4,
    weapon: { damage: 17, range: 6, cooldown: 0.55, type: 'flak', hitsGround: false, hitsAir: true },
  },
  howler: {
    name: 'Howler', role: 'Artillery. Long range splash, slow shells you can dodge.',
    cost: 220, hp: 160, armor: 'light', layer: 'ground', speed: 1.8, sight: 6,
    buildTime: 9, builtAt: 'foundry', radius: 0.45,
    weapon: {
      damage: 58, range: 9, minRange: 2.5, cooldown: 3.5, type: 'shell',
      hitsGround: true, hitsAir: false, projectileSpeed: 7, splash: 1.3,
    },
  },
  dart: {
    name: 'Dart', role: 'Strike drone. Ground attack, untouchable by tanks.',
    cost: 160, hp: 150, armor: 'air', layer: 'air', speed: 4.6, sight: 7,
    buildTime: 7, builtAt: 'aerie', radius: 0.4,
    weapon: { damage: 20, range: 3.5, cooldown: 0.9, type: 'missile', hitsGround: true, hitsAir: false },
  },
  kestrel: {
    name: 'Kestrel', role: 'Interceptor drone. Hunts other drones.',
    cost: 170, hp: 180, armor: 'air', layer: 'air', speed: 5.2, sight: 8,
    buildTime: 7, builtAt: 'aerie', radius: 0.4,
    weapon: { damage: 26, range: 5, cooldown: 0.8, type: 'flak', hitsGround: false, hitsAir: true },
  },
};

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  hq: {
    name: 'HQ', cost: 0, hp: 5000, size: 3, sight: 8, buildTime: 1,
    dropOff: true, trains: ['mule'],
  },
  foundry: {
    name: 'Foundry', cost: 300, hp: 1300, size: 3, sight: 5, buildTime: 14,
    trains: ['skiff', 'ram', 'thistle', 'howler'],
  },
  aerie: {
    name: 'Aerie', cost: 400, hp: 1000, size: 3, sight: 5, buildTime: 18, requires: 'foundry',
    trains: ['dart', 'kestrel'],
  },
  depot: {
    name: 'Depot', cost: 250, hp: 900, size: 2, sight: 6, buildTime: 12, dropOff: true,
  },
  turret: {
    name: 'Turret', cost: 200, hp: 800, size: 1, sight: 7, buildTime: 10, requires: 'foundry',
    weapon: { damage: 24, range: 6, cooldown: 0.9, type: 'turret', hitsGround: true, hitsAir: true },
  },
};

export const UNIT_KINDS = Object.keys(UNITS) as UnitKind[];
export const BUILDING_KINDS = Object.keys(BUILDINGS) as BuildingKind[];
export const PLACEABLE: BuildingKind[] = ['foundry', 'aerie', 'depot', 'turret'];

export const ticks = (seconds: number) => Math.round(seconds * TICK_RATE);
