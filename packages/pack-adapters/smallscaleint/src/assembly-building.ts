import { stoneGable } from './assembly-roof.js';
import { stoneShell } from './assembly-shell.js';
import type { BoundaryEdge } from './boundary.js';
import type { Cell } from './placement.js';

/** Provisional shell and gable. Step geometry and doorway traversal still require visual validation. */
export function provisionalStoneBuilding(footprint: readonly Cell[], door: BoundaryEdge, walkable: readonly Cell[]) {
  const shell = stoneShell(footprint, door, walkable);
  return { placements: [...shell.placements, ...stoneGable(footprint)], entry: shell.entry };
}
