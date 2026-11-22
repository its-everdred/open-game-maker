import type { AssetLoader } from '@gm/sdk/assets';
import type Phaser from 'phaser';

/**
 * Dual-grid 16 terrain transitions, layered by priority (#1200, layout A).
 *
 * Map data stays one terrain index per cell. Each display corner (a cell vertex) reads the four cells around it and,
 * per terrain layer k, picks one of 16 corner cases: which of those cells are terrain k or higher. A higher terrain
 * overlays every lower one, so any number of terrains can meet at a corner. Each cell is drawn as four 64x32 quarter
 * pieces, one from each corner around it, which keeps the map edge on cell borders.
 */

const TILE_WIDTH = 128;
const TILE_HEIGHT = 64;

/** Corner bits of a case: which of the four cells around a vertex hold the terrain (or higher). */
export const CORNER = { top: 1, right: 2, left: 4, bottom: 8 } as const;
export const CASES = 16;
export const FULL_CASE = 15;
/** Quarters of a cell, named by the cell vertex they touch. */
export const QUARTERS = ['top', 'right', 'left', 'bottom'] as const;
export type Quarter = (typeof QUARTERS)[number];
export const VARIANTS = 3;

/**
 * Sheet layout every terrain sheet follows: 64x32 frames, 16 columns (the case), and one row per
 * (variant, quarter), so frame = ((variant * 4 + quarter) * 16 + case).
 */
export const terrainSheet = {
  frameWidth: TILE_WIDTH / 2,
  frameHeight: TILE_HEIGHT / 2,
  columns: CASES,
  rows: VARIANTS * QUARTERS.length,
} as const;

/** Offsets of each cell quarter's centre from the cell's diamond centre. */
const QUARTER_OFFSET: Record<Quarter, { x: number; y: number }> = {
  top: { x: 0, y: -TILE_HEIGHT / 4 },
  right: { x: TILE_WIDTH / 4, y: 0 },
  left: { x: -TILE_WIDTH / 4, y: 0 },
  bottom: { x: 0, y: TILE_HEIGHT / 4 },
};
/** The vertex each quarter touches, relative to the cell. */
const QUARTER_VERTEX: Record<Quarter, { x: number; y: number }> = {
  top: { x: 0, y: 0 },
  right: { x: 1, y: 0 },
  left: { x: 0, y: 1 },
  bottom: { x: 1, y: 1 },
};

export interface TerrainSpec {
  /** Role name for the terrain, e.g. `grass`. */
  id: string;
  /** Lock id of the terrain's quarter sheet ({@link terrainSheet} layout). */
  sheet: string;
  /** Cells of this terrain block movement. Transitions never change a cell's collision. */
  solid?: boolean;
  /** Lock ids of floor-anchored decals scattered on cells deep inside this terrain. */
  decals?: readonly string[];
  /** Chance per eligible cell of one decal, 0-1. */
  decalChance?: number;
}

export interface TerrainMapOptions {
  width: number;
  height: number;
  /** Lowest priority first: a later terrain overlays every earlier one. */
  terrains: readonly TerrainSpec[];
  /** Row-major terrain index per cell. */
  cells: ArrayLike<number>;
  /** Picks edge variants and decals; the same seed always draws the same ground. */
  seed: number;
}

export interface TerrainPiece {
  key: string;
  x: number;
  y: number;
  layer: number;
  quarter: Quarter;
  case: number;
  variant: number;
  frame: number;
}

export interface TerrainDecal {
  key: string;
  x: number;
  y: number;
  asset: string;
  facing: 'E' | 'N' | 'W' | 'S';
}

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 32-bit integer hash of the arguments; deterministic and seed-dependent. */
export function terrainHash(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

/** Cell (x, y)'s centre in the same world space as `IsoMap.render`. */
function cellCentre(x: number, y: number, mapHeight: number): { x: number; y: number } {
  return { x: mapHeight * (TILE_WIDTH / 2) + (x - y) * (TILE_WIDTH / 2), y: TILE_HEIGHT + (x + y) * (TILE_HEIGHT / 2) };
}

const FACINGS = ['E', 'N', 'W', 'S'] as const;

/** Cell terrain state with undoable brush strokes; derives every transition piece from the cells alone. */
export class TerrainMap {
  readonly width: number;
  readonly height: number;
  readonly terrains: readonly TerrainSpec[];
  readonly seed: number;
  readonly #cells: Uint8Array;
  readonly #undo: { index: number; before: number; after: number }[][] = [];
  readonly #redo: { index: number; before: number; after: number }[][] = [];

  constructor(options: TerrainMapOptions) {
    const { width, height, terrains, cells, seed } = options;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('terrain map size must be positive integers');
    }
    if (terrains.length < 1 || terrains.length > 255) throw new Error('terrain map needs 1-255 terrains');
    if (new Set(terrains.map((terrain) => terrain.id)).size !== terrains.length) {
      throw new Error('terrain ids must be unique');
    }
    if (cells.length !== width * height) throw new Error(`terrain cells do not cover the ${width}x${height} map`);
    if (!Number.isSafeInteger(seed)) throw new Error('terrain seed must be a safe integer');
    this.width = width;
    this.height = height;
    this.terrains = terrains;
    this.seed = seed;
    this.#cells = new Uint8Array(width * height);
    for (let index = 0; index < cells.length; index++) this.#cells[index] = this.#checked(cells[index]!);
  }

  #checked(terrain: number): number {
    if (!Number.isInteger(terrain) || terrain < 0 || terrain >= this.terrains.length) {
      throw new Error(`terrain index ${terrain} is not one of the ${this.terrains.length} terrains`);
    }
    return terrain;
  }

  /** Terrain index of a cell; cells off the map read as their nearest edge cell. */
  at(x: number, y: number): number {
    const cx = Math.min(Math.max(x, 0), this.width - 1);
    const cy = Math.min(Math.max(y, 0), this.height - 1);
    return this.#cells[cy * this.width + cx]!;
  }

  cells(): number[] {
    return [...this.#cells];
  }

  /** Corner case of terrain layer `layer` at vertex (vx, vy), the corner shared by cells (vx-1..vx, vy-1..vy). */
  cornerCase(vx: number, vy: number, layer: number): number {
    return (
      (this.at(vx - 1, vy - 1) >= layer ? CORNER.top : 0) |
      (this.at(vx, vy - 1) >= layer ? CORNER.right : 0) |
      (this.at(vx - 1, vy) >= layer ? CORNER.left : 0) |
      (this.at(vx, vy) >= layer ? CORNER.bottom : 0)
    );
  }

  /**
   * Edge variant of a corner; every quarter cut from that corner shares it, so the edge stays continuous. Corners
   * next to each other along a grid line differ inside each seeded 2x2 block, so no edge repeats more than twice.
   */
  variantOf(vx: number, vy: number, layer: number): number {
    return (vx + 2 * vy + (terrainHash(this.seed, vx >> 1, vy >> 1, layer) % VARIANTS)) % VARIANTS;
  }

  /** Quarter pieces of one cell, bottom layer first: per quarter, one piece per terrain present at its corner. */
  piecesAt(x: number, y: number): TerrainPiece[] {
    const pieces: TerrainPiece[] = [];
    QUARTERS.forEach((quarter, quarterIndex) => {
      const vx = x + QUARTER_VERTEX[quarter].x;
      const vy = y + QUARTER_VERTEX[quarter].y;
      // Only terrains in the four cells around the corner are drawn: an absent middle terrain would add its own noisy
      // edge on top of the next one and eat into the lower terrain. The lowest present one is always a full piece.
      const present = [
        ...new Set([this.at(vx - 1, vy - 1), this.at(vx, vy - 1), this.at(vx - 1, vy), this.at(vx, vy)]),
      ].sort((a, b) => a - b);
      for (const layer of present) {
        const kind = this.cornerCase(vx, vy, layer);
        const variant = this.variantOf(vx, vy, layer);
        pieces.push({
          key: `terrain:${layer}:${quarter}:${x},${y}`,
          x,
          y,
          layer,
          quarter,
          case: kind,
          variant,
          frame: (variant * QUARTERS.length + quarterIndex) * CASES + kind,
        });
      }
    });
    return pieces;
  }

  pieces(): TerrainPiece[] {
    const pieces: TerrainPiece[] = [];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) pieces.push(...this.piecesAt(x, y));
    return pieces;
  }

  /** Seeded decals on cells whose eight neighbours share their terrain, so no decal straddles an edge. */
  decals(): TerrainDecal[] {
    const decals: TerrainDecal[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const decal = this.decalAt(x, y);
        if (decal) decals.push(decal);
      }
    }
    return decals;
  }

  decalAt(x: number, y: number): TerrainDecal | undefined {
    const terrain = this.at(x, y);
    const spec = this.terrains[terrain]!;
    if (!spec.decals?.length || !spec.decalChance) return undefined;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.at(x + dx, y + dy) !== terrain) return;
    const roll = terrainHash(this.seed, x, y, 0x5eed);
    if ((roll % 10_000) / 10_000 >= spec.decalChance) return undefined;
    return {
      key: `decal:${x},${y}`,
      x,
      y,
      asset: spec.decals[(roll >>> 14) % spec.decals.length]!,
      facing: FACINGS[(roll >>> 24) % FACINGS.length]!,
    };
  }

  /** `[y][x]` is true for a cell whose terrain is solid; transition art never moves collision off the cell. */
  collisionGrid(): boolean[][] {
    return Array.from({ length: this.height }, (_, y) =>
      Array.from({ length: this.width }, (_, x) => this.terrains[this.at(x, y)]!.solid === true),
    );
  }

  /** Paints `terrain` on cells (one undo step) and returns the cells to redraw, or undefined for a no-op. */
  paint(cells: readonly { x: number; y: number }[], terrain: number): CellRect | undefined {
    this.#checked(terrain);
    const step: { index: number; before: number; after: number }[] = [];
    const seen = new Set<number>();
    for (const { x, y } of cells) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.width || y >= this.height) {
        continue;
      }
      const index = y * this.width + x;
      if (seen.has(index) || this.#cells[index] === terrain) continue;
      seen.add(index);
      step.push({ index, before: this.#cells[index]!, after: terrain });
    }
    if (step.length === 0) return undefined;
    this.#redo.length = 0;
    this.#undo.push(step);
    return this.#apply(step, 'after');
  }

  canUndo(): boolean {
    return this.#undo.length > 0;
  }

  canRedo(): boolean {
    return this.#redo.length > 0;
  }

  undo(): CellRect | undefined {
    const step = this.#undo.pop();
    if (!step) return undefined;
    this.#redo.push(step);
    return this.#apply(step, 'before');
  }

  redo(): CellRect | undefined {
    const step = this.#redo.pop();
    if (!step) return undefined;
    this.#undo.push(step);
    return this.#apply(step, 'after');
  }

  /** Writes a step and returns the cells to redraw: a changed cell moves the corners of its 8 neighbours too. */
  #apply(step: readonly { index: number; before: number; after: number }[], side: 'before' | 'after'): CellRect {
    let minX = this.width,
      minY = this.height,
      maxX = 0,
      maxY = 0;
    for (const change of step) {
      this.#cells[change.index] = change[side];
      const x = change.index % this.width;
      const y = Math.floor(change.index / this.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const x = Math.max(0, minX - 1);
    const y = Math.max(0, minY - 1);
    return {
      x,
      y,
      width: Math.min(this.width - 1, maxX + 1) - x + 1,
      height: Math.min(this.height - 1, maxY + 1) - y + 1,
    };
  }
}

export interface RenderedTerrain {
  /** Redraws the pieces and decals of the cells a brush stroke, undo or redo returned. */
  refresh(rect: CellRect): void;
  destroy(): void;
}

/** Ground sits below every IsoMap piece: just above the IsoMap floor layer (depth -1), decals above the pieces. */
const TERRAIN_DEPTH = -0.9;
const LAYER_STEP = 0.001;
const DECAL_DEPTH = -0.5;

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Draws a {@link TerrainMap} with Phaser: one image per quarter piece, positioned like `IsoMap.render`. */
export async function renderTerrain(
  scene: Phaser.Scene,
  loader: AssetLoader,
  map: TerrainMap,
): Promise<RenderedTerrain> {
  const keys = new Set<string>();
  const sheetKey = (layer: number) => `terrain-sheet:${map.terrains[layer]!.sheet}`;
  map.terrains.forEach((terrain, layer) => {
    const key = sheetKey(layer);
    if (scene.textures.exists(key) || keys.has(key)) return;
    scene.load.spritesheet(key, loader.resolve(terrain.sheet).url, {
      frameWidth: terrainSheet.frameWidth,
      frameHeight: terrainSheet.frameHeight,
    });
    keys.add(key);
  });
  const decalAssets = new Set(map.terrains.flatMap((terrain) => terrain.decals ?? []));
  for (const asset of decalAssets) {
    const resolved = loader.resolve(asset);
    for (const facing of FACINGS) {
      const key = `${asset}:${facing}`;
      if (scene.textures.exists(key) || keys.has(key)) continue;
      const path = resolved.meta?.sprite?.facings?.[facing];
      if (!path) throw new Error(`Asset ${asset} has no ${facing} isometric facing`);
      scene.load.image(key, new URL(basename(path), resolved.url).toString());
      keys.add(key);
    }
  }
  await loadAll(scene, keys);

  const cellObjects = new Map<number, Phaser.GameObjects.Image[]>();
  const draw = (x: number, y: number) => {
    const index = y * map.width + x;
    for (const object of cellObjects.get(index) ?? []) object.destroy();
    const centre = cellCentre(x, y, map.height);
    const objects = map.piecesAt(x, y).map((piece) =>
      scene.add
        .image(
          centre.x + QUARTER_OFFSET[piece.quarter].x,
          centre.y + QUARTER_OFFSET[piece.quarter].y,
          sheetKey(piece.layer),
          piece.frame,
        )
        .setOrigin(0.5, 0.5)
        .setDepth(TERRAIN_DEPTH + piece.layer * LAYER_STEP),
    );
    const decal = map.decalAt(x, y);
    if (decal) {
      const texture = `${decal.asset}:${decal.facing}`;
      objects.push(
        scene.add
          .image(centre.x, centre.y, texture)
          .setOrigin(0.5, 208 / scene.textures.get(texture).getSourceImage().height)
          .setDepth(DECAL_DEPTH),
      );
    }
    cellObjects.set(index, objects);
  };
  const refresh = (rect: CellRect) => {
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) draw(x, y);
  };
  refresh({ x: 0, y: 0, width: map.width, height: map.height });
  return {
    refresh,
    destroy() {
      for (const objects of cellObjects.values()) for (const object of objects) object.destroy();
      cellObjects.clear();
    },
  };
}

function loadAll(scene: Phaser.Scene, keys: ReadonlySet<string>): Promise<void> {
  if (keys.size === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const failed: string[] = [];
    const onError = (file: { key: string; src?: string }) => {
      if (keys.has(file.key)) failed.push(`${file.key} (${file.src ?? 'no url'})`);
    };
    scene.load.on('loaderror', onError);
    scene.load.once('complete', () => {
      scene.load.off('loaderror', onError);
      if (failed.length > 0) reject(new Error(`Failed to load terrain: ${failed.join(', ')}`));
      else resolve();
    });
    scene.load.start();
  });
}
