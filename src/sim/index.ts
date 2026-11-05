// Public surface of the simulation layer.
export * from './types';
export * from './balance';
export { createWorld, placementError, hasBuilding, buildingCentre, distTo, entityPos, armyValue, nearestCrystal } from './world';
export { issue, canHit } from './commands';
export { step, isVisibleTo, updateFog } from './tick';
export { MAPS, getMap } from './maps';
export { worldHash } from './hash';
export { Commander, PERSONALITIES, DIFFICULTIES, type Personality, type Difficulty } from './ai/commander';
