import { SeededRng } from '@gm/sdk/core';
import { describe, expect, it } from 'vitest';

import {
  CASES,
  CORNER,
  FULL_CASE,
  QUARTERS,
  TerrainMap,
  VARIANTS,
  terrainSheet,
  type TerrainSpec,
} from '../src/index.js';

// Lowest priority first, as in the approved layout: dirt < dry grass < grass < dark grass < cobble < paving.
const TERRAINS: TerrainSpec[] = [
  { id: 'dirt', sheet: 't3:test/dirt' },
  { id: 'dry-grass', sheet: 't3:test/dry-grass' },
  { id: 'grass', sheet: 't3:test/grass', decals: ['t3:test/tuft-a', 't3:test/tuft-b'], decalChance: 0.3 },
  { id: 'dark-grass', sheet: 't3:test/dark-grass' },
  { id: 'cobble', sheet: 't3:test/cobble' },
  { id: 'paving', sheet: 't3:test/paving', solid: true },
];

/** Seeded generation the way games do it (open-games #7): blobs of terrain grown from a seeded rng. */
function generate(seed: number, width = 24, height = 24): number[] {
  const rng = new SeededRng(seed);
  const cells = Array<number>(width * height).fill(0);
  for (let blob = 0; blob < 14; blob++) {
    const terrain = 1 + rng.int(TERRAINS.length - 1);
    const cx = rng.int(width);
    const cy = rng.int(height);
    const radius = 1 + rng.next() * 4;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (Math.hypot(x - cx, y - cy) + rng.next() * 1.2 <= radius) cells[y * width + x] = terrain;
      }
    }
  }
  return cells;
}

const SEEDS = [1, 7, 42, 1204, 90_001, 2_026_112];

function mapOf(seed: number, width = 24, height = 24) {
  return new TerrainMap({ width, height, terrains: TERRAINS, cells: generate(seed, width, height), seed });
}

describe('dual-grid corner cases', () => {
  it('reads the four cells around a vertex as top, right, left, bottom', () => {
    // 2x2 map: top-left grass, the rest dirt; the shared vertex (1,1) sees grass only on its top cell.
    const map = new TerrainMap({ width: 2, height: 2, terrains: TERRAINS, cells: [2, 0, 0, 0], seed: 1 });
    expect(map.cornerCase(1, 1, 2)).toBe(CORNER.top);
    const right = new TerrainMap({ width: 2, height: 2, terrains: TERRAINS, cells: [0, 2, 0, 0], seed: 1 });
    expect(right.cornerCase(1, 1, 2)).toBe(CORNER.right);
    const left = new TerrainMap({ width: 2, height: 2, terrains: TERRAINS, cells: [0, 0, 2, 0], seed: 1 });
    expect(left.cornerCase(1, 1, 2)).toBe(CORNER.left);
    const bottom = new TerrainMap({ width: 2, height: 2, terrains: TERRAINS, cells: [0, 0, 0, 2], seed: 1 });
    expect(bottom.cornerCase(1, 1, 2)).toBe(CORNER.bottom);
  });

  it('layers by priority, so three terrains at one corner resolve without a three-terrain tile', () => {
    // dirt, grass and paving meet at vertex (1,1); paving overlays grass, grass overlays dirt.
    const map = new TerrainMap({ width: 2, height: 2, terrains: TERRAINS, cells: [0, 2, 5, 2], seed: 1 });
    expect(map.cornerCase(1, 1, 0)).toBe(FULL_CASE);
    expect(map.cornerCase(1, 1, 2)).toBe(CORNER.right | CORNER.left | CORNER.bottom);
    expect(map.cornerCase(1, 1, 5)).toBe(CORNER.left);
    // Lower layers are drawn first so the higher terrain lands on top.
    const layers = map
      .piecesAt(0, 0)
      .filter((piece) => piece.quarter === 'bottom')
      .map((piece) => piece.layer);
    expect(layers).toEqual([0, 1, 2, 3, 4, 5].filter((layer) => map.cornerCase(1, 1, layer) !== 0));
    expect(layers).toEqual([...layers].sort((a, b) => a - b));
  });

  it('skips quarters a full higher piece already hides', () => {
    const map = new TerrainMap({ width: 3, height: 3, terrains: TERRAINS, cells: Array(9).fill(4), seed: 1 });
    expect(map.piecesAt(1, 1).map((piece) => [piece.layer, piece.case])).toEqual(QUARTERS.map(() => [4, FULL_CASE]));
  });

  it('indexes frames inside the sheet layout', () => {
    expect(terrainSheet.columns * terrainSheet.rows).toBe(CASES * VARIANTS * QUARTERS.length);
  });
});

describe.each(SEEDS)('seeded map %i', (seed) => {
  const map = mapOf(seed);
  const pieces = map.pieces();

  it('uses several terrains, so the seed exercises transitions', () => {
    expect(new Set(map.cells()).size).toBeGreaterThanOrEqual(4);
    expect(pieces.some((piece) => piece.case !== FULL_CASE)).toBe(true);
  });

  it('covers every quarter of every cell with an opaque bottom piece and a sheet frame (no missing case)', () => {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const cell = map.piecesAt(x, y);
        for (const quarter of QUARTERS) {
          const stack = cell.filter((piece) => piece.quarter === quarter);
          expect(stack.length, `${x},${y} ${quarter}`).toBeGreaterThan(0);
          expect(stack[0]!.case, `${x},${y} ${quarter} bottom piece`).toBe(FULL_CASE);
          // The cell's own terrain is always drawn there: the art never shows a terrain the cell is not near.
          expect(stack.some((piece) => piece.layer === map.at(x, y))).toBe(true);
        }
        for (const piece of cell) {
          expect(piece.case).toBeGreaterThan(0);
          expect(piece.case).toBeLessThan(CASES);
          expect(piece.frame).toBeGreaterThanOrEqual(0);
          expect(piece.frame).toBeLessThan(terrainSheet.columns * terrainSheet.rows);
        }
      }
    }
  });

  it('cuts the four quarters around a vertex from one corner tile, so they join without a seam', () => {
    const byVertex = new Map<string, Set<string>>();
    const vertexOf = { top: [0, 0], right: [1, 0], left: [0, 1], bottom: [1, 1] } as const;
    for (const piece of pieces) {
      const [dx, dy] = vertexOf[piece.quarter];
      const key = `${piece.x + dx},${piece.y + dy},${piece.layer}`;
      byVertex.set(key, (byVertex.get(key) ?? new Set()).add(`${piece.case}/${piece.variant}`));
    }
    for (const [vertex, tiles] of byVertex) expect([...tiles], vertex).toHaveLength(1);
  });

  it('varies the edges along a long boundary instead of repeating one piece', () => {
    // A straight 40-cell grass/dirt boundary: every corner on it has the same case.
    const width = 40;
    const straight = new TerrainMap({
      width,
      height: 2,
      terrains: TERRAINS,
      cells: [...Array(width).fill(2), ...Array(width).fill(0)],
      seed,
    });
    const variants = Array.from({ length: width - 1 }, (_, i) => straight.variantOf(i + 1, 1, 2));
    const counts = Array.from({ length: VARIANTS }, (_, v) => variants.filter((value) => value === v).length);
    for (const count of counts) expect(count).toBeGreaterThanOrEqual(5);
    let run = 1;
    let longest = 1;
    for (let i = 1; i < variants.length; i++) {
      run = variants[i] === variants[i - 1] ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(2);
  });

  it('keeps collision per cell: walkability follows the cell terrain, never the transition art', () => {
    const grid = map.collisionGrid();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) expect(grid[y]![x]).toBe(map.at(x, y) === 5);
    }
  });

  it('only scatters decals deep inside their terrain', () => {
    for (const decal of map.decals()) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) expect(map.at(decal.x + dx, decal.y + dy)).toBe(2);
      }
    }
  });

  it('draws the same ground for the same seed', () => {
    expect(mapOf(seed).pieces()).toEqual(pieces);
    expect(mapOf(seed).decals()).toEqual(map.decals());
  });
});

describe('seeds', () => {
  it('pick different edge variants on the same cells', () => {
    const cells = generate(3);
    const a = new TerrainMap({ width: 24, height: 24, terrains: TERRAINS, cells, seed: 1 }).pieces();
    const b = new TerrainMap({ width: 24, height: 24, terrains: TERRAINS, cells, seed: 2 }).pieces();
    expect(a.map((piece) => piece.variant)).not.toEqual(b.map((piece) => piece.variant));
  });
});

describe('brush', () => {
  const blank = () => new TerrainMap({ width: 8, height: 8, terrains: TERRAINS, cells: Array(64).fill(0), seed: 9 });

  it('repaints the stroke and returns the cells whose corners moved', () => {
    const map = blank();
    const rect = map.paint([{ x: 3, y: 3 }], 2);
    expect(rect).toEqual({ x: 2, y: 2, width: 3, height: 3 });
    expect(map.at(3, 3)).toBe(2);
    // Every cell outside the rect draws exactly as before the stroke.
    const before = blank();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (x >= 2 && x <= 4 && y >= 2 && y <= 4) continue;
        expect(map.piecesAt(x, y)).toEqual(before.piecesAt(x, y));
      }
    }
    // And the neighbours on the rect's rim really changed (the grass reaches into them).
    expect(map.piecesAt(2, 2)).not.toEqual(before.piecesAt(2, 2));
  });

  it('clips the redraw rect to the map at the edge', () => {
    expect(blank().paint([{ x: 0, y: 7 }], 3)).toEqual({ x: 0, y: 6, width: 2, height: 2 });
  });

  it('undoes and redoes a whole stroke as one step', () => {
    const map = blank();
    const original = map.pieces();
    map.paint(
      [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ],
      4,
    );
    const painted = map.pieces();
    expect(map.undo()).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    expect(map.pieces()).toEqual(original);
    expect(map.canUndo()).toBe(false);
    map.redo();
    expect(map.pieces()).toEqual(painted);
  });

  it('records no step for a stroke that changes nothing, and a new stroke clears redo', () => {
    const map = blank();
    expect(map.paint([{ x: 1, y: 1 }], 0)).toBeUndefined();
    expect(map.paint([{ x: 99, y: 1 }], 2)).toBeUndefined();
    expect(map.canUndo()).toBe(false);
    map.paint([{ x: 1, y: 1 }], 2);
    map.undo();
    expect(map.canRedo()).toBe(true);
    map.paint([{ x: 5, y: 5 }], 1);
    expect(map.canRedo()).toBe(false);
  });

  it('rejects an unknown terrain', () => {
    expect(() => blank().paint([{ x: 1, y: 1 }], 6)).toThrow(/not one of the 6 terrains/);
  });
});
