import { provisionalStoneBuilding } from './assembly-building.js';
import { provisionalTimberBuilding } from './assembly-timber-building.js';
import { naturalScatter, variedSteppingStonePath, type DressingStyle, type SteppingStyle } from './assembly-ground.js';
import type { AssemblyPlacement } from './assembly-map.js';
import type { BoundaryEdge } from './boundary.js';
import type { Cell, ScatterRules } from './placement.js';

export { edgeRun, type EdgeKind, type GatePostStyle } from './assembly-edge.js';
export { assemblyMap, type AssemblyPlacement } from './assembly-map.js';
export type { BoundaryEdge, CellEdge } from './boundary.js';
export type { EdgePolyline } from './polyline-edges.js';
export type { Cell, ScatterRules } from './placement.js';
export type { DressingStyle, SteppingStyle } from './assembly-ground.js';

/** Closed shell, gable roof over the footprint, and a door opening onto a walkable entry cell. */
export function building(
  footprint: readonly Cell[],
  style: 'stone' | 'timber',
  door: BoundaryEdge,
  walkable: readonly Cell[],
): { placements: AssemblyPlacement[]; entry: Cell } {
  if (style === 'stone') return provisionalStoneBuilding(footprint, door, walkable);
  if (style === 'timber') return provisionalTimberBuilding(footprint, door, walkable);
  throw new Error('only stone and timber building styles are assembled');
}

/** Connected stepping stones between two walkable entries, varied deterministically by seed. */
export function path(from: Cell, to: Cell, style: SteppingStyle): AssemblyPlacement[] {
  return variedSteppingStonePath(from, to, style);
}

/** Seeded natural dressing: clustered, denser along boundaries, never on reserved path or entry cells. */
export function scatter(
  region: readonly Cell[],
  palette: readonly DressingStyle[],
  density: number,
  rules: ScatterRules,
): AssemblyPlacement[] {
  return naturalScatter(region, palette, density, rules);
}
