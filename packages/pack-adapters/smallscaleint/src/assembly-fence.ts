import { edgeRun } from './assembly-edge.js';
import type { BoundaryEdge } from './boundary.js';
import type { Cell } from './placement.js';

/** Measured Fence B1 placements and grid vertices for the gate-post binding. */
export function fenceRun(cells: readonly Cell[], openings: readonly BoundaryEdge[]) {
  return edgeRun(cells, 'fence', openings);
}
