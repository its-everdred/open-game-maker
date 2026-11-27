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
  wallF1Edges,
  wallF6Edges,
  wallC1Edges,
  wallC6Edges,
  structuralImageBounds,
  inspectedGatePost,
  type AlphaBounds,
  type StructuralImageBounds,
} from './structural-bounds.js';
export { structuralCardFacts } from './structural-card.js';
export {
  assemblyMap,
  building,
  edgeRun,
  path,
  scatter,
  type AssemblyPlacement,
  type BoundaryEdge,
  type Cell,
  type CellEdge,
  type DressingStyle,
  type EdgeKind,
  type EdgePolyline,
  type GatePostStyle,
  type ScatterRules,
  type SteppingStyle,
} from './assemblers.js';
export {
  CASES,
  CORNER,
  FULL_CASE,
  QUARTERS,
  TerrainMap,
  VARIANTS,
  renderTerrain,
  terrainHash,
  terrainSheet,
  type CellRect,
  type Quarter,
  type RenderedTerrain,
  type TerrainDecal,
  type TerrainMapOptions,
  type TerrainPiece,
  type TerrainSpec,
} from './terrain.js';
export {
  isoMapToScene,
  sceneToIsoMap,
  SMALLSCALEINT_SCENE_ADAPTER,
  SPAWN_ASSET,
  SPAWNS_LAYER,
} from './scene-convert.js';
export { SCENE_LAYERS, smallScaleIntSceneAdapter, type SmallScaleIntSceneAdapter } from './scene-adapter.js';
export {
  cellAt,
  cellCenter,
  gridAt,
  sceneDrawList,
  sceneExtent,
  SCENE_IMAGE_ANCHOR_Y,
  type SceneDrawPiece,
} from './scene-draw.js';
