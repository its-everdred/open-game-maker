import type { AssemblyPlacement } from './assembly-map.js';
import { boundary, type BoundaryEdge, type CellEdge } from './boundary.js';
import type { TileFacing } from './map.js';
import { verticesForOpenings } from './openings.js';
import { polylineEdges, type EdgePolyline } from './polyline-edges.js';
import type { Cell } from './placement.js';
import { fenceB1Edges, inspectedGatePost, wallC1Edges, wallF1Edges } from './structural-bounds.js';

export type EdgeKind = 'fence' | 'stone' | 'timber';
export interface GatePostStyle {
  asset: string;
  facing: TileFacing;
  scale: number;
}
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

/** Boundary placements and opening endpoints; a supplied post style adds approximate yMax gate posts. */
export function edgeRun(
  shape: readonly Cell[] | EdgePolyline,
  kind: EdgeKind,
  openings: readonly BoundaryEdge[] = [],
  postStyle?: GatePostStyle,
) {
  if (!Object.hasOwn(STYLES, kind)) throw new Error('unknown edge kind');
  const style = STYLES[kind];
  const edges = Array.isArray(shape) ? boundary(shape) : polylineEdges(shape as EdgePolyline);
  const postVertices = verticesForOpenings(edges, openings);
  const omitted = new Set(openings.map(({ cell, edge }) => `${cell.x},${cell.y}:${edge}`));
  // Collision is per cell: an opening's cell that keeps another edge stays solid and seals the gate, so refuse it.
  const openCells = new Set(openings.map(({ cell }) => `${cell.x},${cell.y}`));
  for (const { cell, edge } of edges) {
    if (openCells.has(`${cell.x},${cell.y}`) && !omitted.has(`${cell.x},${cell.y}:${edge}`)) {
      throw new Error('an opening cell must not carry another edge; move the gate off the corner');
    }
  }
  const placements: AssemblyPlacement[] = edges
    .filter(({ cell, edge }) => !omitted.has(`${cell.x},${cell.y}:${edge}`))
    .map(({ cell, edge }) => {
      const facing = (Object.entries(style.edges.value) as [TileFacing, CellEdge][]).find(
        ([, value]) => value === edge,
      )![0];
      return { cell, layer: 'wall', asset: style.asset, facing, solid: true };
    });
  if (postStyle) {
    if (kind !== 'fence' || openings.some(({ edge }) => edge !== 'yMax'))
      throw new Error('gate post placement is only inspected for yMax fence openings');
    if (
      !postStyle.asset ||
      !['E', 'N', 'S', 'W'].includes(postStyle.facing) ||
      !Number.isFinite(postStyle.scale) ||
      postStyle.scale <= 0
    )
      throw new Error('gate post style needs an asset, facing, and positive scale');
    const inspected = inspectedGatePost.value;
    if (
      postStyle.asset !== inspected.asset ||
      postStyle.facing !== inspected.facing ||
      postStyle.scale !== inspected.scale
    )
      throw new Error('gate post placement is only inspected for Stone A14 facing E at scale 0.4');
    for (const vertex of postVertices) {
      const cell = { x: vertex.x - inspected.placementOffset.x, y: vertex.y - inspected.placementOffset.y };
      if (cell.x < 0 || cell.y < 0) throw new Error('gate posts need an enclosing map margin');
      placements.push({
        cell,
        layer: 'decor',
        asset: postStyle.asset,
        facing: postStyle.facing,
        scale: postStyle.scale,
        role: 'post',
        solid: false,
      });
    }
  }
  return { placements, postVertices };
}
