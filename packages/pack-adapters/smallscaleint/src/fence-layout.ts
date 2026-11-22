import { boundary, type BoundaryEdge } from './boundary.js';
import type { TileFacing } from './map.js';
import { openingVertices } from './openings.js';
import type { Cell } from './placement.js';
import { fenceB1Edges } from './structural-bounds.js';

/** Layout the measured rural fence on a footprint boundary, leaving the supplied openings. */
export function fenceLayout(cells: readonly Cell[], openings: readonly BoundaryEdge[] = []) {
  return boundary(cells, openings).map((part) => {
    const facing = (Object.entries(fenceB1Edges.value) as [TileFacing, BoundaryEdge['edge']][]).find(
      ([, edge]) => edge === part.edge,
    )![0];
    return { ...part, facing };
  });
}

/** A boundary run and the grid vertices at either end of each opening. */
export function fenceGateLayout(cells: readonly Cell[], openings: readonly BoundaryEdge[]) {
  return { pieces: fenceLayout(cells, openings), posts: openingVertices(cells, openings) };
}
