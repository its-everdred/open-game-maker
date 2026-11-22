import type { BoundaryEdge } from './boundary.js';
import type { Cell } from './placement.js';

export interface EdgePolyline {
  vertices: readonly Cell[];
  /** The side of each directed segment whose cells own the placed sprites. */
  interior: 'left' | 'right';
}

/** Expand axis-aligned grid-vertex segments into oriented cell edges. */
export function polylineEdges(polyline: EdgePolyline): BoundaryEdge[] {
  if (polyline.interior !== 'left' && polyline.interior !== 'right')
    throw new Error('polyline interior must be left or right');
  if (polyline.vertices.length < 2) throw new Error('polyline needs at least two vertices');
  const result: BoundaryEdge[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < polyline.vertices.length; i++) {
    const a = polyline.vertices[i - 1]!;
    const b = polyline.vertices[i]!;
    if (![a.x, a.y, b.x, b.y].every(Number.isSafeInteger))
      throw new Error('polyline vertices must use integer coordinates');
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    if ((dx === 0) === (dy === 0)) throw new Error('polyline segments must be nonzero and axis-aligned');
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (let step = 0; step < length; step++) {
      const x = a.x + dx * step;
      const y = a.y + dy * step;
      let edge: BoundaryEdge;
      if (dx !== 0) {
        const positiveY = dx > 0 === (polyline.interior === 'right');
        edge = { cell: { x: Math.min(x, x + dx), y: y + (positiveY ? 0 : -1) }, edge: positiveY ? 'yMin' : 'yMax' };
      } else {
        const positiveX = dy > 0 === (polyline.interior === 'left');
        edge = { cell: { x: x + (positiveX ? 0 : -1), y: Math.min(y, y + dy) }, edge: positiveX ? 'xMin' : 'xMax' };
      }
      const key = dx !== 0 ? `h:${Math.min(x, x + dx)},${y}` : `v:${x},${Math.min(y, y + dy)}`;
      if (seen.has(key)) throw new Error('polyline repeats an edge');
      seen.add(key);
      result.push(edge);
    }
  }
  return result;
}
