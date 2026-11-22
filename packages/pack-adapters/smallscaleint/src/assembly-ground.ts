import type { AssemblyPlacement } from './assembly-map.js';
import type { TileFacing } from './map.js';
import { path, scatter, type Cell, type ScatterRules } from './placement.js';

export interface DressingStyle {
  asset: string;
  facing: TileFacing;
  solid: boolean;
  /** Occupied cell offsets from the placement origin, including (0, 0). */
  footprint: readonly Cell[];
}

/** Seeded decoration placements that respect reserved path and entry cells. Solid items go on the wall layer so they collide. */
export function naturalScatter(
  region: readonly Cell[],
  palette: readonly DressingStyle[],
  density: number,
  rules: ScatterRules,
): AssemblyPlacement[] {
  for (const item of palette) {
    if (
      !item.footprint.length ||
      !item.footprint.some(({ x, y }) => x === 0 && y === 0) ||
      item.footprint.some(({ x, y }) => !Number.isSafeInteger(x) || !Number.isSafeInteger(y))
    ) {
      throw new Error('dressing footprint must contain integer offsets including the origin');
    }
  }
  const occupied = new Set(rules.avoid.map(({ x, y }) => `${x},${y}`));
  const result: AssemblyPlacement[] = [];
  for (const { cell, item } of scatter(region, palette, density, rules)) {
    const footprint = item.footprint.map(({ x, y }) => `${cell.x + x},${cell.y + y}`);
    if (footprint.some((key) => occupied.has(key))) continue;
    for (const key of footprint) occupied.add(key);
    result.push({
      cell,
      layer: item.solid ? 'wall' : 'decor',
      asset: item.asset,
      facing: item.facing,
      solid: item.solid,
    });
  }
  return result;
}

export interface SteppingStyle {
  walkable: readonly Cell[];
  palette: readonly { asset: string; facing: TileFacing }[];
  seed: number;
}

/** Connected stepping-stone route with deterministic per-cell variation over existing ground. */
export function variedSteppingStonePath(from: Cell, to: Cell, style: SteppingStyle): AssemblyPlacement[] {
  const route = path(from, to, style.walkable);
  return scatter(route, style.palette, 1, { seed: style.seed, avoid: [], boundaries: route, boundaryDensity: 1 }).map(
    ({ cell, item }) => ({ cell, layer: 'decor', asset: item.asset, facing: item.facing, solid: false }),
  );
}
