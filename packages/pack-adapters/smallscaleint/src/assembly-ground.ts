import type { AssemblyPlacement } from './assembly-map.js';
import type { TileFacing } from './map.js';
import { path, scatter, type Cell, type ScatterRules } from './placement.js';

export interface PavingStyle {
  asset: string;
  facing: TileFacing;
  walkable: readonly Cell[];
}

/** Connected, non-solid paving placements between two walkable entries. */
export function pavingPath(from: Cell, to: Cell, style: PavingStyle): AssemblyPlacement[] {
  return path(from, to, style.walkable).map((cell) => ({
    cell,
    layer: 'floor',
    asset: style.asset,
    facing: style.facing,
    solid: false,
  }));
}

/** Transparent stepping stones placed above an existing ground layer. */
export function steppingStonePath(from: Cell, to: Cell, style: PavingStyle): AssemblyPlacement[] {
  return pavingPath(from, to, style).map((piece) => ({ ...piece, layer: 'decor' }));
}

export interface DressingStyle {
  asset: string;
  facing: TileFacing;
  solid: boolean;
}

/** Seeded decoration placements that respect reserved path and entry cells. */
export function naturalScatter(
  region: readonly Cell[],
  palette: readonly DressingStyle[],
  density: number,
  rules: ScatterRules,
): AssemblyPlacement[] {
  return scatter(region, palette, density, rules).map(({ cell, item }) => ({
    cell,
    layer: 'decor',
    asset: item.asset,
    facing: item.facing,
    solid: item.solid,
  }));
}
