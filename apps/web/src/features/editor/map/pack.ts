import {
  cellAt,
  cellCenter,
  sceneDrawList,
  sceneExtent,
  SCENE_IMAGE_ANCHOR_Y,
  smallScaleIntSceneAdapter,
  SMALLSCALEINT_SCENE_ADAPTER,
  type SceneDrawPiece,
} from '@gm/pack-smallscaleint/scene';
import type { SceneDoc, ScenePackAdapter } from '@ogm/contracts/browser';

import type { Cell } from './edit';

export type Point = { x: number; y: number };
export type Sprites = Record<string, { facings: Record<string, string> }>;

/**
 * What the map maker needs from a scene's pack (#1209): its placement rules and how to draw and pick its pieces. The
 * editor itself knows no pack; a scene opens only when its `packAdapter` has an entry here.
 */
export type MapPack = {
  adapter: ScenePackAdapter;
  /** Visible pieces back to front, positioned in map pixels. */
  draw(doc: SceneDoc): SceneDrawPiece[];
  extent(doc: SceneDoc): { left: number; top: number; width: number; height: number };
  cellAt(doc: SceneDoc, point: Point): Cell | undefined;
  cellCenter(doc: SceneDoc, cell: Cell): Point;
  /** How far above its cell centre a piece's image starts, for drawing a piece that is not in the scene yet. */
  anchorY: number;
  /** The tile layer a piece goes on (one of `groups`). */
  layerFor(asset: string): string;
  /** The tray's groups, in order. */
  groups: readonly string[];
};

const FACING_ORDER = ['E', 'N', 'W', 'S'];

function smallScaleInt(sprites: Sprites): MapPack {
  const rules = smallScaleIntSceneAdapter();
  const adapter: ScenePackAdapter = {
    ...rules,
    /* Turn only to facings the game locked an image for; the adapter alone would offer all four. */
    facings: (asset) => {
      const drawn = sprites[asset]?.facings;
      return drawn ? FACING_ORDER.filter((facing) => drawn[facing]) : rules.facings(asset);
    },
  };
  return {
    adapter,
    draw: sceneDrawList,
    extent: sceneExtent,
    cellAt,
    cellCenter: (doc, cell) => cellCenter(doc, cell.x, cell.y),
    anchorY: SCENE_IMAGE_ANCHOR_Y,
    layerFor: (asset) => rules.layerFor(asset),
    groups: ['floor', 'wall', 'decor', 'roof'],
  };
}

export function packFor(doc: SceneDoc, sprites: Sprites): MapPack | undefined {
  return doc.packAdapter === SMALLSCALEINT_SCENE_ADAPTER ? smallScaleInt(sprites) : undefined;
}

/** `t1:pack/tiles/environment/chest-a1@2026-11-01` → `Chest a1`, for labels a screen reader reads. */
export function assetName(asset: string): string {
  const name = (asset.split('/').at(-1) ?? asset).replace(/@.*$/, '').replace(/[-_]+/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Labels for a set of pieces, naming the pack where two packs share a piece name. */
export function assetLabels(assets: readonly string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const asset of assets) counts.set(assetName(asset), (counts.get(assetName(asset)) ?? 0) + 1);
  return new Map(
    assets.map((asset) => {
      const name = assetName(asset);
      const pack = asset.replace(/^t\d:/, '').split('/')[0]!.replace(/[-_]+/g, ' ');
      return [asset, counts.get(name)! > 1 ? `${name}, ${pack}` : name];
    }),
  );
}

export type { SceneDrawPiece };
