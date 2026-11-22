import type { Grid } from './grid.js';
import { DRESSING, cellKey, type Camera, type Cell, type Finding, type Piece } from './model.js';
import { spawnOf } from './traverse.js';
import { viewSamples } from './view.js';

export interface PlacementOptions {
  /** Fewest dressing props per 10 floor cells before the scene reads as bare. */
  minDensity: number;
  camera: Camera;
}

const BLOCK = 6;

/** Sorted unique values form an even progression with a step of at least 2 (a planted grid, not a cluster). */
function even(values: readonly number[]): boolean {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length < 2) return true;
  const step = sorted[1]! - sorted[0]!;
  return step >= 2 && sorted.every((value, i) => i === 0 || value - sorted[i - 1]! === step);
}

function lattice(pieces: readonly Piece[]): boolean {
  if (pieces.length < 6) return false;
  const xs = pieces.map((piece) => piece.x);
  const ys = pieces.map((piece) => piece.y);
  const slots = new Set(xs).size * new Set(ys).size;
  return even(xs) && even(ys) && new Set(pieces.map(cellKey)).size >= 0.8 * slots;
}

/** Dressing looks grown, not stamped: dense enough, never on a lattice unless formal, grounded, and no void in frame. */
export function naturalPlacement(grid: Grid, options: PlacementOptions): Finding[] {
  const findings: Finding[] = [];
  const pieces = grid.scene.pieces;
  const dressing = pieces.filter((piece) => piece.layer !== 'floor' && DRESSING.has(piece.role));
  const density = grid.floor.size ? (dressing.length * 10) / grid.floor.size : 0;
  if (density < options.minDensity) {
    findings.push({
      check: 'natural-placement',
      id: 'natural-placement/sparse',
      severity: 'medium',
      message: `${dressing.length} props over ${grid.floor.size} floor cells is ${density.toFixed(2)} per 10 cells; dress it to at least ${options.minDensity}`,
      cells: [],
      objects: [],
    });
  }
  const b = grid.scene.bounds;
  for (let y0 = b.minY; y0 <= b.maxY; y0 += BLOCK) {
    for (let x0 = b.minX; x0 <= b.maxX; x0 += BLOCK) {
      const cells: Cell[] = [];
      for (let y = y0; y < y0 + BLOCK; y++) for (let x = x0; x < x0 + BLOCK; x++) cells.push({ x, y });
      const floor = cells.filter((cell) => grid.floor.has(cellKey(cell)));
      if (
        floor.length < (BLOCK * BLOCK * 2) / 3 ||
        cells.some((cell) => grid.at(cell).some((p) => p.layer !== 'floor'))
      )
        continue;
      findings.push({
        check: 'natural-placement',
        id: 'natural-placement/bare-patch',
        severity: 'low',
        message: `${BLOCK}x${BLOCK} patch from (${x0},${y0}) holds ${floor.length} floor cells and nothing else`,
        cells: floor,
        objects: [],
      });
    }
  }
  const groups = new Map<string, Piece[]>([['all props', dressing]]);
  for (const piece of dressing) groups.set(piece.asset, [...(groups.get(piece.asset) ?? []), piece]);
  const reported = new Set<string>();
  for (const [name, group] of groups) {
    const informal = group.filter((piece) => !piece.tags.has('formal'));
    const id = informal.map(cellKey).sort().join(' ');
    if (!lattice(informal) || reported.has(id)) continue;
    reported.add(id);
    findings.push({
      check: 'natural-placement',
      id: 'natural-placement/grid',
      severity: 'medium',
      message: `${informal.length} ${name === 'all props' ? 'props' : name} sit on a regular grid; cluster and vary them, or tag them formal`,
      cells: informal.map((piece) => ({ x: piece.x, y: piece.y })),
      objects: informal.map((piece) => piece.key),
    });
  }
  const voids = pieces.filter(
    (piece) => piece.layer !== 'floor' && piece.role !== 'roof' && !grid.floor.has(cellKey(piece)),
  );
  if (voids.length) {
    findings.push({
      check: 'natural-placement',
      id: 'natural-placement/over-void',
      severity: 'high',
      message: `${voids.length} piece(s) stand on cells with no ground under them`,
      cells: voids.map((piece) => ({ x: piece.x, y: piece.y })),
      objects: voids.map((piece) => piece.key),
    });
  }
  const floating = pieces.filter((piece) => piece.elevation > 0 && piece.role !== 'roof');
  if (floating.length) {
    findings.push({
      check: 'natural-placement',
      id: 'natural-placement/floating',
      severity: 'medium',
      message: `${floating.length} non-roof piece(s) are lifted off the ground`,
      cells: floating.map((piece) => ({ x: piece.x, y: piece.y })),
      objects: floating.map((piece) => piece.key),
    });
  }
  const center = options.camera.center ?? spawnOf(grid.scene.actors);
  if (center) {
    const edge = new Map<string, Cell>();
    for (const cell of viewSamples(grid.scene, options.camera, center)) {
      if (!grid.floor.has(cellKey(cell))) edge.set(cellKey(cell), cell);
    }
    if (edge.size) {
      findings.push({
        check: 'natural-placement',
        id: 'natural-placement/edge-in-frame',
        severity: 'high',
        message: `the ${options.camera.width}x${options.camera.height} frame at zoom ${options.camera.zoom} around (${center.x},${center.y}) shows ${edge.size} cell(s) of void past the map edge`,
        cells: [...edge.values()],
        objects: [],
      });
    }
  }
  return findings;
}
