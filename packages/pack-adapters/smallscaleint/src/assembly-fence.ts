import type { AssemblyPlacement } from './assembly-map.js';
import type { BoundaryEdge } from './boundary.js';
import { fenceGateLayout } from './fence-layout.js';
import type { Cell } from './placement.js';

/** Measured Fence B1 placements and grid vertices for the gate-post binding. */
export function fenceRun(cells: readonly Cell[], openings: readonly BoundaryEdge[]) {
  const layout = fenceGateLayout(cells, openings);
  const placements: AssemblyPlacement[] = layout.pieces.map(({ cell, facing }) => ({
    cell,
    layer: 'wall',
    asset: 't1:smallscaleint-2d-hd-zombie-rural-tileset/tiles/isometric-tiles/fence-b1@2026-11-01',
    facing,
    solid: true,
  }));
  return { placements, postVertices: layout.posts };
}
