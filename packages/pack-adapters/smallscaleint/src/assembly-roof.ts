import type { AssemblyPlacement } from './assembly-map.js';
import type { Cell } from './placement.js';

/** Provisional two-row gable, locally inspected against a rectangular stone shell. */
export function stoneGable(footprint: readonly Cell[]): AssemblyPlacement[] {
  if (!footprint.length) throw new Error('roof footprint must not be empty');
  if (footprint.some(({ x, y }) => !Number.isSafeInteger(x) || !Number.isSafeInteger(y))) {
    throw new Error('roof footprint cells must use integer coordinates');
  }
  const unique = new Map(footprint.map((cell) => [`${cell.x},${cell.y}`, cell]));
  const cells = [...unique.values()];
  const minX = Math.min(...cells.map(({ x }) => x));
  const maxX = Math.max(...cells.map(({ x }) => x));
  const minY = Math.min(...cells.map(({ y }) => y));
  const maxY = Math.max(...cells.map(({ y }) => y));
  if (maxY - minY !== 1 || cells.length !== (maxX - minX + 1) * 2) {
    throw new Error('stone gable currently requires a full two-row rectangle');
  }
  return cells.map((cell) => ({
    cell,
    layer: 'roof',
    asset: 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/roof-d1@2026-11-01',
    facing: cell.y === minY ? 'N' : 'S',
    solid: false,
    elevation: 1.75,
  }));
}
