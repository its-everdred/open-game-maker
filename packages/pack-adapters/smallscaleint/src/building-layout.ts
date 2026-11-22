import { boundary, type BoundaryEdge } from './boundary.js';
import type { Cell } from './placement.js';

const key = ({ x, y }: Cell) => `${x},${y}`;
const offsets = { xMin: [-1, 0], xMax: [1, 0], yMin: [0, -1], yMax: [0, 1] } as const;

/** Topology for a shell, including the exterior cell a doorway opens onto. */
export function buildingLayout(footprint: readonly Cell[], door: BoundaryEdge, walkable: readonly Cell[]) {
  const cells = new Map(footprint.map((cell) => [key(cell), cell]));
  if (cells.size === 0) throw new Error('building footprint must not be empty');
  const unvisited = new Set(cells.keys());
  const pending = [footprint[0]!];
  unvisited.delete(key(pending[0]!));
  for (let i = 0; i < pending.length; i++) {
    const current = pending[i]!;
    for (const [dx, dy] of Object.values(offsets)) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (unvisited.delete(key(next))) pending.push(next);
    }
  }
  if (unvisited.size) throw new Error('building footprint must be connected');
  const exterior = boundary(footprint);
  if (!exterior.some((part) => key(part.cell) === key(door.cell) && part.edge === door.edge)) {
    throw new Error('door must be on the building boundary');
  }
  const [dx, dy] = offsets[door.edge];
  const entry = { x: door.cell.x + dx, y: door.cell.y + dy };
  if (!walkable.some((cell) => key(cell) === key(entry))) throw new Error('door must open onto a walkable cell');
  return { walls: boundary(footprint, [door]), door, entry, roof: [...cells.values()] };
}
