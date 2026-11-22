import { NEIGHBORS, cellKey, corners, segment, type Cell, type Piece, type Role, type Scene } from './model.js';

const OPEN: ReadonlySet<Role> = new Set(['ground', 'path', 'door', 'opening']);
const TERMINATES: ReadonlySet<Role> = new Set(['post', 'roof', 'door', 'opening']);

/** Grid vertices where a run may legally end: corners of posts, buildings, doors and declared gates. */
export function terminals(pieces: readonly Piece[]): Set<string> {
  const ends = new Set<string>();
  for (const piece of pieces) {
    if (TERMINATES.has(piece.role) || piece.tags.has('gate')) for (const v of corners(piece)) ends.add(cellKey(v));
  }
  return ends;
}

/** Cell occupancy derived once per scene: floor, blocking pieces and reachability. */
export class Grid {
  readonly floor = new Set<string>();
  readonly blocked = new Set<string>();
  readonly byCell = new Map<string, Piece[]>();

  constructor(readonly scene: Scene) {
    for (const piece of scene.pieces) {
      const key = cellKey(piece);
      if (!this.byCell.has(key)) this.byCell.set(key, []);
      this.byCell.get(key)!.push(piece);
      if (piece.layer === 'floor') this.floor.add(key);
      else if (piece.solid && !OPEN.has(piece.role)) this.blocked.add(key);
    }
  }

  inBounds({ x, y }: Cell): boolean {
    const b = this.scene.bounds;
    return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  }

  walkable(cell: Cell): boolean {
    const key = cellKey(cell);
    return this.floor.has(key) && !this.blocked.has(key);
  }

  at(cell: Cell): Piece[] {
    return this.byCell.get(cellKey(cell)) ?? [];
  }

  /** Every walkable cell reachable from `start` over 4-neighbour steps. */
  reach(start: Cell): Set<string> {
    const seen = new Set<string>();
    if (!this.walkable(start)) return seen;
    const queue = [start];
    seen.add(cellKey(start));
    for (let i = 0; i < queue.length; i++) {
      for (const [dx, dy] of NEIGHBORS) {
        const next = { x: queue[i]!.x + dx, y: queue[i]!.y + dy };
        const key = cellKey(next);
        if (!seen.has(key) && this.walkable(next)) {
          seen.add(key);
          queue.push(next);
        }
      }
    }
    return seen;
  }
}

export interface Segment {
  piece: Piece;
  a: Cell;
  b: Cell;
  key: string;
}

/** Grid segments drawn by pieces with a measured edge, for the given roles. */
export function segments(pieces: readonly Piece[], roles: ReadonlySet<Role>): Segment[] {
  return pieces
    .filter((piece) => piece.edge && roles.has(piece.role))
    .map((piece) => ({ piece, ...segment(piece, piece.edge!) }));
}

/** Segments meeting at each grid vertex. */
export function vertexIndex(parts: readonly Segment[]): Map<string, Segment[]> {
  const index = new Map<string, Segment[]>();
  for (const part of parts) {
    for (const end of [part.a, part.b]) {
      const key = cellKey(end);
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push(part);
    }
  }
  return index;
}

/** Connected groups of segments that share a vertex. */
export function components(parts: readonly Segment[]): Segment[][] {
  const index = vertexIndex(parts);
  const seen = new Set<Segment>();
  const groups: Segment[][] = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    const group: Segment[] = [];
    const queue = [part];
    seen.add(part);
    while (queue.length) {
      const current = queue.pop()!;
      group.push(current);
      for (const end of [current.a, current.b]) {
        for (const next of index.get(cellKey(end))!) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

export const pieceCells = (parts: readonly { piece: Piece }[]): Cell[] => {
  const cells = new Map<string, Cell>();
  for (const { piece } of parts) cells.set(cellKey(piece), { x: piece.x, y: piece.y });
  return [...cells.values()];
};
