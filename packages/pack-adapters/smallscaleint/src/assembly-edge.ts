import type { AssemblyPlacement } from './assembly-map.js';
import { boundary, type BoundaryEdge, type CellEdge } from './boundary.js';
import type { TileFacing } from './map.js';
import { verticesForOpenings } from './openings.js';
import { polylineEdges, type EdgePolyline } from './polyline-edges.js';
import type { Cell } from './placement.js';
import { fenceB1Edges, wallC1Edges, wallF1Edges } from './structural-bounds.js';

export type EdgeKind = 'fence' | 'stone' | 'timber';
const STYLES = {
  fence: {
    asset: 't1:smallscaleint-2d-hd-zombie-rural-tileset/tiles/isometric-tiles/fence-b1@2026-11-01',
    edges: fenceB1Edges,
  },
  stone: {
    asset: 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-f1@2026-11-01',
    edges: wallF1Edges,
  },
  timber: {
    asset: 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-c1@2026-11-01',
    edges: wallC1Edges,
  },
} as const;

/** Boundary placements and opening endpoints; post sprites are not bound until their anchors are verified. */
export function edgeRun(shape: readonly Cell[] | EdgePolyline, kind: EdgeKind, openings: readonly BoundaryEdge[] = []) {
  if (!Object.hasOwn(STYLES, kind)) throw new Error('unknown edge kind');
  const style = STYLES[kind];
  const edges = Array.isArray(shape) ? boundary(shape) : polylineEdges(shape as EdgePolyline);
  const postVertices = verticesForOpenings(edges, openings);
  const omitted = new Set(openings.map(({ cell, edge }) => `${cell.x},${cell.y}:${edge}`));
  const placements: AssemblyPlacement[] = edges
    .filter(({ cell, edge }) => !omitted.has(`${cell.x},${cell.y}:${edge}`))
    .map(({ cell, edge }) => {
      const facing = (Object.entries(style.edges.value) as [TileFacing, CellEdge][]).find(
        ([, value]) => value === edge,
      )![0];
      return { cell, layer: 'wall', asset: style.asset, facing, solid: true };
    });
  return { placements, postVertices };
}
