import type { SceneDoc, ScenePackAdapter, SceneTile } from '@ogm/contracts/browser';

/**
 * The map maker's edits on a scene document (#1209). Game-agnostic: each returns a new document (or the same one when
 * nothing changed), and pack rules (facings, joins) come from the scene's pack adapter.
 */

export type Cell = { x: number; y: number };
/** A painted cell on one tile layer. */
export type TileRef = { layer: string; cell: string };

export const cellKey = ({ x, y }: Cell): string => `${x},${y}`;
export const parseCell = (cell: string): Cell => {
  const [x, y] = cell.split(',').map(Number) as [number, number];
  return { x, y };
};

export function tileAt(doc: SceneDoc, ref: TileRef): SceneTile | undefined {
  return doc.layers[ref.layer]?.tiles?.[ref.cell];
}

function inBounds(doc: SceneDoc, cell: Cell): boolean {
  const bounds = doc.bounds;
  return !bounds || (cell.x >= 0 && cell.y >= 0 && cell.x < bounds.width && cell.y < bounds.height);
}

function withTiles(doc: SceneDoc, layer: string, edit: (tiles: Record<string, SceneTile>) => void): SceneDoc {
  const current = doc.layers[layer];
  if (current?.kind !== 'tiles') return doc;
  const tiles = { ...current.tiles };
  edit(tiles);
  return { ...doc, layers: { ...doc.layers, [layer]: { ...current, tiles } } };
}

/** Let the pack re-pick joined pieces (fences, walls, shores) around the cells that changed. */
function joined(doc: SceneDoc, adapter: ScenePackAdapter, layer: string, cells: readonly string[]): SceneDoc {
  if (!adapter.autotile || cells.length === 0) return doc;
  const { layers, objects } = adapter.autotile(doc, layer, cells);
  return layers === doc.layers && objects === doc.objects ? doc : { ...doc, layers, objects };
}

/** Paint `asset` on a cell, in its first drawn facing unless one is given. A creator lock is the store's business. */
export function paint(
  doc: SceneDoc,
  adapter: ScenePackAdapter,
  layer: string,
  cell: Cell,
  asset: string,
  facing?: string,
): SceneDoc {
  if (!inBounds(doc, cell)) return doc;
  const key = cellKey(cell);
  const current = doc.layers[layer]?.tiles?.[key];
  const nextFacing = facing ?? adapter.facings(asset)[0];
  if (current?.asset === asset && current.facing === nextFacing) return doc;
  const tile: SceneTile = { asset, ...(nextFacing === undefined ? {} : { facing: nextFacing }) };
  return joined(
    withTiles(doc, layer, (tiles) => {
      tiles[key] = tile;
    }),
    adapter,
    layer,
    [key],
  );
}

export function erase(doc: SceneDoc, adapter: ScenePackAdapter, ref: TileRef): SceneDoc {
  if (!tileAt(doc, ref)) return doc;
  return joined(
    withTiles(doc, ref.layer, (tiles) => {
      delete tiles[ref.cell];
    }),
    adapter,
    ref.layer,
    [ref.cell],
  );
}

/** Move a piece to another cell of its layer; a taken or off-map cell refuses, so a drag never swallows a piece. */
export function move(doc: SceneDoc, adapter: ScenePackAdapter, ref: TileRef, to: Cell): SceneDoc {
  const tile = tileAt(doc, ref);
  const key = cellKey(to);
  if (!tile || key === ref.cell || !inBounds(doc, to) || tileAt(doc, { layer: ref.layer, cell: key })) return doc;
  const moved: SceneTile = { ...tile };
  delete moved.lockedBy;
  return joined(
    withTiles(doc, ref.layer, (tiles) => {
      delete tiles[ref.cell];
      tiles[key] = moved;
    }),
    adapter,
    ref.layer,
    [ref.cell, key],
  );
}

/** Turn a piece to its next drawn facing; a piece drawn once does not turn. */
export function rotate(doc: SceneDoc, adapter: ScenePackAdapter, ref: TileRef): SceneDoc {
  const tile = tileAt(doc, ref);
  if (!tile) return doc;
  const facings = adapter.facings(tile.asset);
  if (facings.length < 2) return doc;
  const next = facings[(facings.indexOf(tile.facing ?? facings[0]!) + 1) % facings.length]!;
  return joined(
    withTiles(doc, ref.layer, (tiles) => {
      tiles[ref.cell] = { ...tile, facing: next };
    }),
    adapter,
    ref.layer,
    [ref.cell],
  );
}

/** Copy a piece to the nearest free cell of its layer; returns where it went, or nothing when the layer is full. */
export function duplicate(doc: SceneDoc, adapter: ScenePackAdapter, ref: TileRef): { doc: SceneDoc; ref?: TileRef } {
  const tile = tileAt(doc, ref);
  if (!tile) return { doc };
  const from = parseCell(ref.cell);
  const reach = Math.max(doc.bounds?.width ?? 8, doc.bounds?.height ?? 8);
  for (let ring = 1; ring <= reach; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cell = { x: from.x + dx, y: from.y + dy };
        if (!inBounds(doc, cell) || tileAt(doc, { layer: ref.layer, cell: cellKey(cell) })) continue;
        return {
          doc: paint(doc, adapter, ref.layer, cell, tile.asset, tile.facing),
          ref: { layer: ref.layer, cell: cellKey(cell) },
        };
      }
    }
  }
  return { doc };
}

/** Tile layers front to back, so a tap picks what is drawn on top. */
export function tileLayersFrontToBack(doc: SceneDoc): string[] {
  return Object.entries(doc.layers)
    .filter(([, layer]) => layer.kind === 'tiles')
    .sort(([, a], [, b]) => b.order - a.order)
    .map(([id]) => id);
}

/** Undo and redo over whole documents: a scene is small, and a snapshot can never replay wrongly. */
export type History = { past: SceneDoc[]; present: SceneDoc; future: SceneDoc[] };

const LIMIT = 200;

export const historyOf = (doc: SceneDoc): History => ({ past: [], present: doc, future: [] });

export function record(history: History, doc: SceneDoc): History {
  if (doc === history.present) return history;
  return { past: [...history.past, history.present].slice(-LIMIT), present: doc, future: [] };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: History): History {
  const [next, ...future] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future };
}
