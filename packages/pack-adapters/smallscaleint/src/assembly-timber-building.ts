import { edgeRun } from './assembly-edge.js';
import { buildingLayout } from './building-layout.js';
import { stoneGable } from './assembly-roof.js';
import type { BoundaryEdge } from './boundary.js';
import type { Cell } from './placement.js';

const PACK = 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment';
const asset = (slug: string) => `${PACK}/${slug}@2026-11-01`;

/** Provisional timber shell: yMax doorway and two-row thatched roof, inspected in a standalone scene. */
export function provisionalTimberBuilding(footprint: readonly Cell[], door: BoundaryEdge, walkable: readonly Cell[]) {
  const layout = buildingLayout(footprint, door, walkable);
  if (door.edge !== 'yMax') throw new Error('timber door pairing is only inspected on the yMax edge');
  const walls = edgeRun(footprint, 'timber', [door]).placements.map((piece) => ({
    ...piece,
    depthOffset: piece.facing === 'E' || piece.facing === 'S' ? 16 : -16,
  }));
  const entry = ['wall-c6', 'door-a1'].map((slug) => ({
    cell: door.cell,
    layer: 'wall' as const,
    asset: asset(slug),
    facing: 'S' as const,
    solid: false,
    depthOffset: 16,
    role: slug === 'wall-c6' ? 'opening' : 'door',
  }));
  const roof = stoneGable(footprint).map((piece) => ({ ...piece, asset: asset('roof-a1'), depthOffset: 64 }));
  return { placements: [...walls, ...entry, ...roof], entry: layout.entry };
}
