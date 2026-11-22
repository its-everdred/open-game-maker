import { edgeRun } from './assembly-edge.js';
import { buildingLayout } from './building-layout.js';
import type { BoundaryEdge } from './boundary.js';
import type { Cell } from './placement.js';

const PACK = 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment';
const asset = (slug: string) => `${PACK}/${slug}@2026-11-01`;

/** Provisional stone shell: only the south-facing arch/door pairing has been locally inspected. */
export function stoneShell(footprint: readonly Cell[], door: BoundaryEdge, walkable: readonly Cell[]) {
  const layout = buildingLayout(footprint, door, walkable);
  if (door.edge !== 'yMax') throw new Error('stone door pairing is only inspected on the yMax edge');
  if (layout.walls.some(({ cell }) => cell.x === door.cell.x && cell.y === door.cell.y)) {
    throw new Error('door cell must not carry another wall edge');
  }
  const { placements } = edgeRun(footprint, 'stone', [door]);
  for (const slug of ['wall-f6', 'door-a1']) {
    placements.push({ cell: door.cell, layer: 'wall', asset: asset(slug), facing: 'S', solid: false });
  }
  return { placements, entry: layout.entry, footprint: layout.roof };
}
