/**
 * The Dusk Helm forest clearing from the approved #878 mocks, laid out on the pack's 128x64 isometric cells: a dirt
 * clearing with the hero and a campfire, open grass, then a ring of trees that thickens outward. Pure data, so the
 * layout is testable without a renderer.
 */

export const SIZE = 29;
export const CENTRE = (SIZE - 1) / 2;

export type Cell = readonly [number, number];
export const HERO: Cell = [CENTRE, CENTRE];
export const FIRE: Cell = [CENTRE + 1, CENTRE - 1];

export type PieceKey =
  | 'ground-a1'
  | 'ground-a2'
  | 'ground-a6'
  | 'ground-a8'
  | 'tree-a1'
  | 'tree-a2'
  | 'tree-a3'
  | 'tree-e4'
  | 'stone-a1'
  | 'stone-a3'
  | 'stone-a12'
  | 'fireplace';

export interface Piece {
  key: PieceKey;
  cell: Cell;
  ground: boolean;
  scale: number;
  flip: boolean;
}

/** One depth band: the pieces the focus module blurs together, drawn back to front. */
export interface Band {
  depth: number;
  pieces: Piece[];
}

const TREES: PieceKey[] = ['tree-a1', 'tree-a2', 'tree-a3', 'tree-a1'];
const STONES: PieceKey[] = ['stone-a1', 'stone-a3', 'stone-a12'];

const hash = (x: number, y: number) => ((x * 73_856_093) ^ (y * 19_349_663) ^ (x * y * 83_492_791)) >>> 0;

/** Screen-space centre of a cell in world pixels, origin at the hero's cell. */
export function cellPoint([cx, cy]: Cell): { x: number; y: number } {
  return { x: (cx - cy - (HERO[0] - HERO[1])) * 64, y: (cx + cy - HERO[0] - HERO[1]) * 32 };
}

/** Cells the camera can reach in landscape or portrait, so pieces far off screen are never made. */
function inView([cx, cy]: Cell): boolean {
  return Math.abs(cx - cy) <= 10 && Math.abs(cx + cy - 2 * CENTRE) <= 16;
}

const isDirt = (cx: number, cy: number) => Math.hypot(cx - CENTRE, cy - CENTRE) < 3 + (hash(cx, cy) % 7) * 0.22;

export function clearingPieces(): Piece[] {
  const pieces: Piece[] = [];
  for (let cy = 0; cy < SIZE; cy += 1)
    for (let cx = 0; cx < SIZE; cx += 1) {
      const cell: Cell = [cx, cy];
      if (!inView(cell)) continue;
      const h = hash(cx, cy);
      const d = Math.hypot(cx - CENTRE, cy - CENTRE);
      const dirt = isDirt(cx, cy);
      pieces.push({ key: dirt ? 'ground-a1' : 'ground-a2', cell, ground: true, scale: 1, flip: false });
      // Grass creeps over the dirt at the clearing's edge and in a few patches inside, so the edge is not a tile line.
      const edge =
        dirt &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => !isDirt(cx + dx!, cy + dy!));
      const onAnchor = (cx === FIRE[0] && cy === FIRE[1]) || (cx === HERO[0] && cy === HERO[1]);
      if (!onAnchor && (edge || (dirt && h % 9 === 0)))
        pieces.push({
          key: edge && h % 2 ? 'ground-a6' : 'ground-a8',
          cell,
          ground: false,
          scale: 1,
          flip: h % 3 === 0,
        });
      if (cx === FIRE[0] && cy === FIRE[1]) {
        pieces.push({ key: 'fireplace', cell, ground: false, scale: 1, flip: false });
        continue;
      }
      if (cx === HERO[0] && cy === HERO[1]) continue;
      const ring = d >= 5.8 + (h % 3) * 0.3;
      if (ring && (d >= 7 ? (cx + cy) % 2 === 0 && h % 5 !== 0 : h % 3 === 0)) {
        pieces.push({ key: TREES[h % TREES.length]!, cell, ground: false, scale: h % 2 ? 0.9 : 1, flip: h % 3 === 0 });
      } else if (d > 2.5 && d < 5.5 && h % 11 === 0) {
        pieces.push({ key: STONES[h % STONES.length]!, cell, ground: false, scale: 0.6, flip: h % 2 === 0 });
      }
    }
  pieces.push({ key: 'tree-e4', cell: [CENTRE - 2, CENTRE + 2], ground: false, scale: 1, flip: false });
  return pieces;
}

/** Diagonal rows (cx + cy) relative to the hero that each band covers; the hero draws between bands 2 and 3. */
export const BAND_ROWS: ReadonlyArray<readonly [number, number]> = [
  [-Infinity, -8],
  [-7, -4],
  [-3, 0],
  [1, 3],
  [4, 7],
  [8, Infinity],
];

/** The hero's depth: between the band that ends on its row and the next. */
export const HERO_DEPTH = 0.5;

/**
 * Groups pieces into the focus module's depth bands. Each band's depth is its middle row, so the depth-band blur grows
 * with distance from the hero, and draw order (ground before props on each row) stays correct across bands.
 */
export function depthBands(pieces: Piece[]): Band[] {
  const row = (piece: Piece) => piece.cell[0] + piece.cell[1] - HERO[0] - HERO[1];
  return BAND_ROWS.flatMap(([from, to]) => {
    const members = pieces
      .filter((piece) => row(piece) >= from && row(piece) <= to)
      .sort(
        (a, b) =>
          row(a) - row(b) || Number(b.ground) - Number(a.ground) || a.cell[0] - a.cell[1] - (b.cell[0] - b.cell[1]),
      );
    // An empty band has no depth to give (min/max of nothing is NaN), so it is left out.
    if (!members.length) return [];
    const rows = members.map(row);
    const depth = (Math.max(from, Math.min(...rows)) + Math.min(to, Math.max(...rows))) / 2;
    return [{ depth, pieces: members }];
  });
}
