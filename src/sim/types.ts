// Core data types for the deterministic simulation.
// Nothing in src/sim imports from the renderer, the DOM or Math.random.

export type Team = 0 | 1;
export const BLUE: Team = 0;
export const RED: Team = 1;

export const Terrain = {
  Grass: 0,
  Road: 1,
  Woods: 2,
  Rock: 3,
  Water: 4,
} as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

export type UnitKind = 'mule' | 'skiff' | 'ram' | 'thistle' | 'howler' | 'dart' | 'kestrel';
export type BuildingKind = 'hq' | 'foundry' | 'aerie' | 'depot' | 'turret';
export type Armor = 'light' | 'heavy' | 'air' | 'structure';
export type DamageType = 'bullet' | 'cannon' | 'shell' | 'missile' | 'flak' | 'turret';
export type Layer = 'ground' | 'air';

export interface WeaponDef {
  damage: number;
  range: number; // tiles
  minRange?: number;
  cooldown: number; // seconds
  type: DamageType;
  hitsGround: boolean;
  hitsAir: boolean;
  /** Projectile speed in tiles/s. Omitted = instant hit. */
  projectileSpeed?: number;
  /** Splash radius in tiles (only for projectiles). */
  splash?: number;
}

export interface UnitDef {
  name: string;
  role: string;
  cost: number;
  hp: number;
  armor: Armor;
  layer: Layer;
  speed: number; // tiles per second
  sight: number;
  buildTime: number; // seconds
  builtAt: BuildingKind;
  radius: number; // collision radius, tiles
  weapon?: WeaponDef;
  /** Harvest capacity, only for harvesters */
  capacity?: number;
}

export interface BuildingDef {
  name: string;
  cost: number;
  hp: number;
  size: number; // square footprint, tiles
  sight: number;
  buildTime: number;
  requires?: BuildingKind;
  dropOff?: boolean;
  weapon?: WeaponDef;
  trains?: UnitKind[];
}

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number }
  | { type: 'attackMove'; x: number; y: number }
  | { type: 'attack'; target: number }
  | { type: 'harvest'; crystal: number; phase: 'toField' | 'mining' | 'toDrop' };

export interface Unit {
  id: number;
  team: Team;
  kind: UnitKind;
  x: number;
  y: number;
  /** Position at the previous tick, for render interpolation. */
  px: number;
  py: number;
  facing: number;
  hp: number;
  order: Order;
  path: { x: number; y: number }[] | null;
  /** Where the current path leads, so it can be reused. */
  pathGoal: { x: number; y: number } | null;
  repathIn: number;
  cooldown: number; // ticks
  /** Target the unit is shooting this tick (auto or ordered). */
  target: number;
  lastAttacker: number;
  cargo: number;
  kills: number;
  rank: number;
  stuckTicks: number;
}

export interface Building {
  id: number;
  team: Team;
  kind: BuildingKind;
  tx: number;
  ty: number;
  size: number;
  hp: number;
  /** Construction progress in ticks; complete when >= def build ticks. */
  progress: number;
  complete: boolean;
  queue: UnitKind[];
  prodTicks: number;
  rally: { x: number; y: number } | null;
  cooldown: number;
  target: number;
  lastAttacker: number;
}

export interface Crystal {
  id: number;
  tx: number;
  ty: number;
  amount: number;
  rich: boolean;
}

export interface Projectile {
  id: number;
  team: Team;
  owner: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  speed: number;
  damage: number;
  type: DamageType;
  splash: number;
  hitsAir: boolean;
  flight: number; // ticks total
  age: number;
}

export interface TeamStats {
  harvested: number;
  spent: number;
  unitsBuilt: number;
  unitsLost: number;
  kills: number;
  armyValueTimeline: number[];
}

export interface TeamState {
  scrap: number;
  stats: TeamStats;
}

export type SimEvent =
  | { e: 'shot'; from: number; x0: number; y0: number; x1: number; y1: number; type: DamageType; team: Team }
  | { e: 'impact'; x: number; y: number; splash: number }
  | { e: 'death'; id: number; x: number; y: number; team: Team; big: boolean; air: boolean }
  | { e: 'spawn'; id: number; team: Team; kind: UnitKind }
  | { e: 'built'; id: number; team: Team; kind: BuildingKind }
  | { e: 'deposit'; team: Team; amount: number; x: number; y: number }
  | { e: 'rankUp'; id: number; team: Team; rank: number }
  | { e: 'underAttack'; team: Team; x: number; y: number }
  | { e: 'gameOver'; winner: Team | 'draw' };

export interface GameMap {
  name: string;
  width: number;
  height: number;
  tiles: Uint8Array;
  /** Top-left tile of each team's HQ. */
  starts: [{ tx: number; ty: number }, { tx: number; ty: number }];
  crystals: { tx: number; ty: number; rich: boolean }[];
}

export type Command =
  | { t: 'move'; team: Team; ids: number[]; x: number; y: number; attack?: boolean }
  | { t: 'attack'; team: Team; ids: number[]; target: number }
  | { t: 'harvest'; team: Team; ids: number[]; crystal: number }
  | { t: 'stop'; team: Team; ids: number[] }
  | { t: 'train'; team: Team; building: number; kind: UnitKind }
  | { t: 'cancel'; team: Team; building: number }
  | { t: 'build'; team: Team; kind: BuildingKind; tx: number; ty: number }
  | { t: 'rally'; team: Team; building: number; x: number; y: number };

export interface World {
  tick: number;
  seed: number;
  rngState: number;
  map: GameMap;
  units: Unit[];
  buildings: Building[];
  crystals: Crystal[];
  projectiles: Projectile[];
  byId: Map<number, Unit | Building>;
  crystalById: Map<number, Crystal>;
  teams: [TeamState, TeamState];
  nextId: number;
  /** Building id occupying each tile, or 0. */
  occupancy: Int32Array;
  /** Crystal id on each tile, or 0. */
  crystalAt: Int32Array;
  visible: [Uint8Array, Uint8Array];
  explored: [Uint8Array, Uint8Array];
  pending: Command[];
  /** Every command ever applied, with its tick: enough to replay the match. */
  log: { tick: number; cmd: Command }[];
  events: SimEvent[];
  winner: Team | 'draw' | null;
}

export function isUnit(e: Unit | Building | undefined): e is Unit {
  return !!e && (e as Unit).order !== undefined;
}
export function isBuilding(e: Unit | Building | undefined): e is Building {
  return !!e && (e as Building).size !== undefined;
}
