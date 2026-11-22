export { DIRECTIONS, conventions, layerForCategory, type Direction, type Fact, type Layer } from './conventions.js';
export { LOOP_ROLES, isRole, loops, roleOf, vocabulary, type Role } from './vocabulary.js';
export { createSpriteActor, facing8, type SpriteActor, type SpriteActorState, type Variant } from './sprite-actor.js';
export {
  IsoMap,
  isoToWorld,
  worldToIso,
  type IsoPiece,
  type IsoPieceState,
  type IsoPoint,
  type IsoSpawn,
  type RenderedIsoMap,
  type RenderedIsoSprite,
  type TiledIsoMap,
  type TileFacing,
} from './map.js';
export {
  paletteFrom,
  validatePlacement,
  type PaletteCategory,
  type PalettePrefab,
  type PlacementKind,
} from './palette.js';
export {
  fenceB1Edges,
  structuralImageBounds,
  type AlphaBounds,
  type StructuralImageBounds,
} from './structural-bounds.js';
export { structuralCardFacts } from './structural-card.js';
