/** Integer cell coordinates in the isometric map grid. */
export interface Cell {
  x: number;
  y: number;
}

const key = ({ x, y }: Cell): string => `${x},${y}`;
const neighbors = ({ x, y }: Cell): Cell[] => [
  { x: x + 1, y },
  { x, y: y + 1 },
  { x: x - 1, y },
  { x, y: y - 1 },
];

/** Find a shortest connected path through the supplied walkable cells, including both ends. */
export function path(from: Cell, to: Cell, walkable: readonly Cell[]): Cell[] {
  const cells = new Map(walkable.map((cell) => [key(cell), cell]));
  const start = key(from);
  const end = key(to);
  if (!cells.has(start) || !cells.has(end)) throw new Error('path endpoints must be walkable');
  const previous = new Map<string, string | null>([[start, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !previous.has(end); i++) {
    const current = queue[i]!;
    for (const next of neighbors(current)) {
      const nextKey = key(next);
      if (cells.has(nextKey) && !previous.has(nextKey)) {
        previous.set(nextKey, key(current));
        queue.push(next);
      }
    }
  }
  if (!previous.has(end)) throw new Error('path endpoints are disconnected');
  const result: Cell[] = [];
  for (let cursor: string | null = end; cursor !== null; cursor = previous.get(cursor)!) {
    result.push(cells.get(cursor)!);
  }
  return result.reverse();
}

export interface ScatterRules {
  seed: number;
  /** Cells that may not be occupied, including paths and entries. */
  avoid: readonly Cell[];
  /** Boundary cells that receive extra dressing. */
  boundaries: readonly Cell[];
  /** Extra placement probability adjacent to boundaries, from 0 to 1. */
  boundaryDensity: number;
}

function random(seed: number, x: number, y: number, salt: number): number {
  let n = Math.imul(seed ^ salt, 0x9e3779b1) ^ Math.imul(x, 0x85ebca6b) ^ Math.imul(y, 0xc2b2ae35);
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 0x100000000;
}

/** Select seeded dressing cells and palette entries without occupying reserved cells. */
export function scatter<T>(
  region: readonly Cell[],
  palette: readonly T[],
  density: number,
  rules: ScatterRules,
): { cell: Cell; item: T }[] {
  if (
    !Number.isFinite(density) ||
    density < 0 ||
    density > 1 ||
    !Number.isFinite(rules.boundaryDensity) ||
    rules.boundaryDensity < 0 ||
    rules.boundaryDensity > 1
  ) {
    throw new Error('scatter densities must be between 0 and 1');
  }
  if (!Number.isSafeInteger(rules.seed)) throw new Error('scatter seed must be an integer');
  if (!palette.length) throw new Error('scatter palette must not be empty');
  const avoid = new Set(rules.avoid.map(key));
  const boundaries = new Set(rules.boundaries.map(key));
  const seen = new Set<string>();
  const result: { cell: Cell; item: T }[] = [];
  for (const cell of region) {
    const id = key(cell);
    if (avoid.has(id) || seen.has(id)) continue;
    seen.add(id);
    const nearBoundary = boundaries.has(id) || neighbors(cell).some((neighbor) => boundaries.has(key(neighbor)));
    // Coarse seeded regions create clusters without making the result depend on input order.
    const cluster = random(rules.seed, Math.floor(cell.x / 3), Math.floor(cell.y / 3), 1);
    const probability = Math.min(1, density * (0.5 + cluster) + (nearBoundary ? rules.boundaryDensity : 0));
    if (random(rules.seed, cell.x, cell.y, 2) < probability) {
      const index = Math.floor(random(rules.seed, cell.x, cell.y, 3) * palette.length);
      result.push({ cell, item: palette[index]! });
    }
  }
  return result;
}
