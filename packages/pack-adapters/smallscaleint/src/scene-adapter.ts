import type { AssetCard, SceneBrush, SceneDoc, ScenePackAdapter, ScenePlacementKind, ScenePoint } from '@ogm/contracts';

import { layerForCategory, type Layer } from './conventions.js';
import { cardsByCategory, categoryFrom, categoryOf, placementOf } from './palette.js';
import { SMALLSCALEINT_SCENE_ADAPTER, SPAWN_ASSET, SPAWNS_LAYER } from './scene-convert.js';

/** Tileset pieces are drawn in four facings (file suffixes `_E`, `_N`, `_W`, `_S`). */
const TILE_FACINGS = ['E', 'N', 'W', 'S'] as const;

/** Default layers of a SmallScaleInt scene, back to front; `IsoMap` needs all five. */
export const SCENE_LAYERS = {
  floor: { kind: 'tiles', order: 0 },
  wall: { kind: 'tiles', order: 1 },
  decor: { kind: 'tiles', order: 2 },
  roof: { kind: 'tiles', order: 3 },
  [SPAWNS_LAYER]: { kind: 'objects', order: 4 },
} as const;

export interface SmallScaleIntSceneAdapter extends ScenePackAdapter {
  /** The layer an asset belongs on, from its measured category (ground → floor, walls and doors → wall). */
  layerFor(asset: string): Layer;
  /** An empty scene with the default layers, for an agent or the editor to start a new map. */
  emptyScene(game: string, scene: string, bounds: { width: number; height: number }): SceneDoc;
}

/**
 * The SmallScaleInt scene adapter. Points are grid coordinates (cell `x, y` is the tile `IsoMap` draws at
 * `isoToWorld(x, y)`): cell placements sit on whole cells, edge placements (walls, doors) on cell edge midpoints.
 * Pass the set's asset cards so facings and brushes come from what each asset was drawn with.
 */
export function smallScaleIntSceneAdapter(cards: readonly AssetCard[] = []): SmallScaleIntSceneAdapter {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const category = (asset: string) => {
    const card = byId.get(asset);
    return card ? categoryOf(card) : categoryFrom(asset);
  };
  const brushes: SceneBrush[] = cardsByCategory(cards, new Set()).map(([name, items]) => ({
    id: name.toLowerCase(),
    label: name,
    layer: layerForCategory(name),
    assets: items.map((card) => card.id),
  }));

  return {
    id: SMALLSCALEINT_SCENE_ADAPTER,
    facings(asset) {
      if (asset === SPAWN_ASSET) return [];
      const drawn = byId.get(asset)?.sprite?.facings;
      return drawn ? TILE_FACINGS.filter((facing) => drawn[facing]) : TILE_FACINGS;
    },
    placement(asset): ScenePlacementKind {
      if (asset === SPAWN_ASSET) return 'free';
      const found = category(asset);
      return found ? placementOf(found) : 'cell';
    },
    snap(point: ScenePoint, kind: ScenePlacementKind): ScenePoint {
      if (kind === 'free') return { ...point };
      if (kind === 'cell') return { x: Math.round(point.x), y: Math.round(point.y) };
      const alongY = { x: Math.round(point.x), y: Math.floor(point.y) + 0.5 };
      const alongX = { x: Math.floor(point.x) + 0.5, y: Math.round(point.y) };
      const distance = (candidate: ScenePoint) => Math.hypot(candidate.x - point.x, candidate.y - point.y);
      return distance(alongY) <= distance(alongX) ? alongY : alongX;
    },
    brushes: () => brushes,
    /**
     * Join rules come from the autotile research spike. Until then pieces keep the facings they were placed with,
     * so this rewrites nothing.
     */
    autotile: (doc) => ({ layers: doc.layers, objects: doc.objects }),
    layerFor(asset) {
      return layerForCategory(category(asset) ?? '');
    },
    emptyScene(game, scene, bounds) {
      const layers = Object.fromEntries(
        Object.entries(SCENE_LAYERS).map(([id, layer]) => [
          id,
          layer.kind === 'tiles' ? { ...layer, tiles: {} } : { ...layer },
        ]),
      );
      return {
        schemaVersion: 1,
        game,
        scene,
        packAdapter: SMALLSCALEINT_SCENE_ADAPTER,
        bounds: { ...bounds },
        layers,
        objects: {},
        hd2d: {},
      };
    },
  };
}
