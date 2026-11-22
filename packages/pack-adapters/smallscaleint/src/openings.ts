import { boundary, type BoundaryEdge } from './boundary.js';
import type { Cell } from './placement.js';

const sameEdge = (a: BoundaryEdge, b: BoundaryEdge) =>
  a.cell.x === b.cell.x && a.cell.y === b.cell.y && a.edge === b.edge;

/** Grid vertices at the two ends of each exterior opening, suitable for later post placement. */
export function openingVertices(cells: readonly Cell[], openings: readonly BoundaryEdge[]): Cell[] {
  return verticesForOpenings(boundary(cells), openings);
}

/** Endpoints of openings selected from an explicit set of edges. */
export function verticesForOpenings(exterior: readonly BoundaryEdge[], openings: readonly BoundaryEdge[]): Cell[] {
  const vertices = new Map<string, { cell: Cell; count: number }>();
  const seen = new Set<string>();
  for (const opening of openings) {
    if (!exterior.some((edge) => sameEdge(edge, opening))) throw new Error('opening must be on the exterior boundary');
    const { x, y } = opening.cell;
    const edgeKey = `${x},${y}:${opening.edge}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    const ends: Record<BoundaryEdge['edge'], [Cell, Cell]> = {
      xMin: [
        { x, y },
        { x, y: y + 1 },
      ],
      xMax: [
        { x: x + 1, y },
        { x: x + 1, y: y + 1 },
      ],
      yMin: [
        { x, y },
        { x: x + 1, y },
      ],
      yMax: [
        { x, y: y + 1 },
        { x: x + 1, y: y + 1 },
      ],
    };
    for (const vertex of ends[opening.edge]) {
      const key = `${vertex.x},${vertex.y}`;
      vertices.set(key, { cell: vertex, count: (vertices.get(key)?.count ?? 0) + 1 });
    }
  }
  return [...vertices.values()].filter(({ count }) => count % 2 === 1).map(({ cell }) => cell);
}
