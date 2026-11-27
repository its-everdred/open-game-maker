import type { SceneDoc } from '@ogm/contracts/browser';

import type { Layer } from './conventions.js';
import { isoToWorld, worldToIso, type IsoPoint } from './map.js';

const TILE_WIDTH = 128;
const TILE_HEIGHT = 64;
/** Pixel row of a facing image that `IsoMap` puts on the tile centre (the middle of the ground diamond). */
export const SCENE_IMAGE_ANCHOR_Y = 208;
const IMAGE_ANCHOR_Y = SCENE_IMAGE_ANCHOR_Y;
const LAYER_DEPTH: Record<Layer, number> = { floor: 0, wall: 0.1, decor: 0.2, roof: 0.3 };

/** One tile as `IsoMap.render` draws it: the facing image's top centre sits `anchorY` above `center`. */
export type SceneDrawPiece = {
  /** The scene unit (`tile:<layer>:<x,y>`), so a pick names what to edit. */
  unit: string;
  layer: string;
  cell: string;
  x: number;
  y: number;
  asset: string;
  facing: string;
  /** World position of the image anchor, in the map's own pixels (the same space `IsoMap` renders in). */
  center: IsoPoint;
  anchorY: number;
  /** Uniform scale around the same ground anchor used by IsoMap. */
  scale?: number;
  depth: number;
  floor: boolean;
};

/** Visible layer ids back to front; `wall-2` is a numbered wall layer. */
function baseLayer(id: string): Layer | undefined {
  const base = id.replace(/-[1-9]\d*$/, '');
  return base === 'floor' || base === 'wall' || base === 'decor' || base === 'roof' ? base : undefined;
}

/** The map pixel where cell (x, y)'s ground diamond is centred. */
export function cellCenter(doc: Pick<SceneDoc, 'bounds'>, x: number, y: number, elevation = 0): IsoPoint {
  const height = doc.bounds?.height ?? 0;
  const point = isoToWorld(x, y);
  return { x: height * (TILE_WIDTH / 2) + point.x, y: TILE_HEIGHT + point.y - elevation * TILE_HEIGHT };
}

/** Grid coordinates (fractional) under a map pixel; cell `x, y` is the whole point nearest its diamond centre. */
export function gridAt(doc: Pick<SceneDoc, 'bounds'>, point: IsoPoint): IsoPoint {
  const height = doc.bounds?.height ?? 0;
  return worldToIso(point.x - height * (TILE_WIDTH / 2), point.y - TILE_HEIGHT);
}

/** The cell under a map pixel, or undefined off the map. */
export function cellAt(doc: Pick<SceneDoc, 'bounds'>, point: IsoPoint): { x: number; y: number } | undefined {
  const grid = gridAt(doc, point);
  /* `|| 0` turns a rounded -0 into 0, so cells compare and key cleanly. */
  const x = Math.round(grid.x) || 0;
  const y = Math.round(grid.y) || 0;
  const bounds = doc.bounds;
  if (!bounds || x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return undefined;
  return { x, y };
}

/** The map's pixel size, so a viewer can fit it; images rise up to `IMAGE_ANCHOR_Y` above a tile centre. */
export function sceneExtent(doc: Pick<SceneDoc, 'bounds'> & Partial<Pick<SceneDoc, 'layers'>>): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const width = doc.bounds?.width ?? 0;
  const height = doc.bounds?.height ?? 0;
  const span = (width + height) * (TILE_WIDTH / 2);
  let maxScale = 1;
  for (const [id, layer] of Object.entries(doc.layers ?? {})) {
    const base = baseLayer(id);
    if (layer.kind !== 'tiles' || layer.visible === false || !base || base === 'floor') continue;
    for (const tile of Object.values(layer.tiles ?? {})) {
      const scale = tile.props?.scale;
      if (typeof scale === 'number' && Number.isFinite(scale) && scale > maxScale) maxScale = scale;
    }
  }
  const extra = maxScale - 1;
  return {
    left: -128 * extra,
    top: TILE_HEIGHT - IMAGE_ANCHOR_Y * maxScale,
    width: span + 256 * extra,
    height: (width + height) * (TILE_HEIGHT / 2) + IMAGE_ANCHOR_Y + 256 * extra,
  };
}

/**
 * Every tile of a scene's visible layers in the order `IsoMap.render` paints them: the floor row by row, then the taller
 * layers by footprint depth. Pure, so a host page can draw a scene the way the game does without Phaser.
 */
export function sceneDrawList(doc: SceneDoc): SceneDrawPiece[] {
  const floor: SceneDrawPiece[] = [];
  const raised: SceneDrawPiece[] = [];
  for (const [id, layer] of Object.entries(doc.layers)) {
    if (layer.kind !== 'tiles' || layer.visible === false) continue;
    const base = baseLayer(id);
    if (!base) continue;
    for (const [cell, tile] of Object.entries(layer.tiles ?? {})) {
      const [x, y] = cell.split(',').map(Number) as [number, number];
      const piece: SceneDrawPiece = {
        unit: `tile:${id}:${cell}`,
        layer: id,
        cell,
        x,
        y,
        asset: tile.asset,
        facing: tile.facing ?? 'E',
        center: cellCenter(doc, x, y, tile.elevation ?? 0),
        anchorY: IMAGE_ANCHOR_Y,
        scale:
          base !== 'floor' &&
          typeof tile.props?.scale === 'number' &&
          Number.isFinite(tile.props.scale) &&
          tile.props.scale > 0
            ? tile.props.scale
            : 1,
        depth: isoToWorld(x, y).y + LAYER_DEPTH[base],
        floor: base === 'floor',
      };
      (piece.floor ? floor : raised).push(piece);
    }
  }
  floor.sort((a, b) => a.y - b.y || a.x - b.x);
  raised.sort((a, b) => a.depth - b.depth || a.x - b.x);
  return [...floor, ...raised];
}
