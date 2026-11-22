import type { Cell } from './placement.js';

export type CellEdge = 'xMin' | 'xMax' | 'yMin' | 'yMax';
export interface BoundaryEdge {
  cell: Cell;
  edge: CellEdge;
}

const key = ({ x, y }: Cell) => `${x},${y}`;
const edgeKey = ({ cell, edge }: BoundaryEdge) => `${key(cell)}:${edge}`;
const sides: readonly { edge: CellEdge; dx: number; dy: number }[] = [
  { edge: 'xMin', dx: -1, dy: 0 },
  { edge: 'xMax', dx: 1, dy: 0 },
  { edge: 'yMin', dx: 0, dy: -1 },
  { edge: 'yMax', dx: 0, dy: 1 },
];

/** Extract the exterior cell edges of a footprint, omitting specified openings. */
export function boundary(cells: readonly Cell[], openings: readonly BoundaryEdge[] = []): BoundaryEdge[] {
  const occupied = new Set(cells.map(key));
  const omitted = new Set(openings.map(edgeKey));
  const found = new Set<string>();
  const result: BoundaryEdge[] = [];
  for (const cell of cells) {
    for (const { edge, dx, dy } of sides) {
      const part = { cell, edge };
      const id = edgeKey(part);
      if (!occupied.has(key({ x: cell.x + dx, y: cell.y + dy })) && !omitted.has(id) && !found.has(id)) {
        found.add(id);
        result.push(part);
      }
    }
  }
  return result;
}
