import { components, pieceCells, segments, vertexIndex, type Grid, type Segment } from './grid.js';
import { NEIGHBORS, cellKey, corners, segment, type Cell, type Finding, type Piece, type Role } from './model.js';

const SHELL: ReadonlySet<Role> = new Set(['wall', 'door', 'opening']);

const at = (cells: readonly Cell[]) => cells.map((c) => `(${c.x},${c.y})`).join(' ');

/**
 * Cells a closed set of edges encloses: everything a flood from outside its box cannot reach. A door with no
 * measured edge seals its own cell, so it closes the gap it stands in.
 */
function enclosed(group: readonly Segment[], sealed: ReadonlySet<string>): Cell[] {
  const walls = new Set(group.map((part) => part.key));
  const xs = group.flatMap((part) => [part.a.x, part.b.x]);
  const ys = group.flatMap((part) => [part.a.y, part.b.y]);
  const box = { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs), y1: Math.max(...ys) };
  const inside = (c: Cell) => c.x >= box.x0 && c.x <= box.x1 && c.y >= box.y0 && c.y <= box.y1;
  const outside = new Set([cellKey({ x: box.x0, y: box.y0 })]);
  const queue: Cell[] = [{ x: box.x0, y: box.y0 }];
  while (queue.length) {
    const cell = queue.pop()!;
    for (const [dx, dy, edge] of NEIGHBORS) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      const key = cellKey(next);
      if (!inside(next) || outside.has(key) || sealed.has(key) || walls.has(segment(cell, edge).key)) continue;
      outside.add(key);
      queue.push(next);
    }
  }
  const cells: Cell[] = [];
  for (let y = box.y0; y <= box.y1; y++)
    for (let x = box.x0; x <= box.x1; x++) {
      if (!outside.has(cellKey({ x, y }))) cells.push({ x, y });
    }
  return cells;
}

/** The closed part of a run: drop segments with a loose end (not at a door standing in the gap) until none remain. */
function shell(run: readonly Segment[], doorCorners: ReadonlySet<string>): Segment[] {
  let kept = [...run];
  for (;;) {
    const index = vertexIndex(kept);
    const loose = (end: Cell) => {
      const key = cellKey(end);
      return !doorCorners.has(key) && new Set(index.get(key)!.map((part) => part.key)).size === 1;
    };
    const next = kept.filter((part) => !loose(part.a) && !loose(part.b));
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

/**
 * A building is a closed shell with a roof over its footprint and a door. A wall run carrying a door or roof
 * that does not close is a facade (the #24 crypt), unless a piece in it is tagged `ruin`.
 */
export function coherentBuildings(grid: Grid): Finding[] {
  const pieces = grid.scene.pieces;
  const parts = segments(pieces, SHELL);
  const loose = pieces.filter(
    (piece) => piece.role === 'roof' || ((piece.role === 'door' || piece.role === 'opening') && !piece.edge),
  );
  const claimed = new Set<Piece>();
  const findings: Finding[] = [];
  for (const run of components(parts)) {
    const vertices = vertexIndex(run);
    const touches = (piece: Piece) => corners(piece).some((v) => vertices.has(cellKey(v)));
    const near = loose.filter(touches);
    const doorCorners = new Set(
      near.filter((piece) => piece.role !== 'roof').flatMap((door) => corners(door).map(cellKey)),
    );
    // A wall that runs on from the shell (a garden wall to a post) is a boundary run, not part of the building.
    const group = shell(run, doorCorners);
    const footprint = group.length
      ? enclosed(group, new Set(near.filter((piece) => piece.role !== 'roof').map(cellKey)))
      : [];
    const inFootprint = new Set(footprint.map(cellKey));
    const attached = loose.filter((piece) => inFootprint.has(cellKey(piece)) || touches(piece));
    const doors = [...run.map((part) => part.piece), ...attached].filter(
      (piece) => piece.role === 'door' || piece.role === 'opening',
    );
    const roofs = attached.filter((piece) => piece.role === 'roof');
    // A roofless enclosure with only a gate or arch is a yard; connected-runs judges it.
    if (!roofs.length && !doors.some((piece) => piece.role === 'door')) continue;
    for (const piece of attached) claimed.add(piece);
    const objects = [...run.map((part) => part.piece.key), ...attached.map((piece) => piece.key)];
    const cells = [...pieceCells(run), ...pieceCells(attached.map((piece) => ({ piece })))];
    const ruin = [...run.map((part) => part.piece), ...attached].some((piece) => piece.tags.has('ruin'));
    if (ruin) continue; // a ruin may stand open and roofless
    if (!group.length) {
      findings.push({
        check: 'coherent-buildings',
        id: 'coherent-buildings/open-shell',
        severity: 'high',
        message: 'building walls do not close a shell; it reads as a free-standing facade. Close it, or tag it ruin',
        cells,
        objects,
      });
      continue;
    }
    if (!doors.length) {
      findings.push({
        check: 'coherent-buildings',
        id: 'coherent-buildings/no-door',
        severity: 'high',
        message: 'closed building has no door or opening',
        cells,
        objects,
      });
    }
    const roofed = new Set(roofs.map(cellKey));
    const bare = footprint.filter((cell) => !roofed.has(cellKey(cell)));
    if (bare.length) {
      findings.push({
        check: 'coherent-buildings',
        id: roofs.length ? 'coherent-buildings/roof-gap' : 'coherent-buildings/no-roof',
        severity: 'high',
        message: roofs.length
          ? `roof leaves ${bare.length} of ${footprint.length} footprint cell(s) open: ${at(bare)}`
          : `building footprint of ${footprint.length} cell(s) has no roof`,
        cells: bare,
        objects,
      });
    }
    const overhang = roofs.filter((roof) => !inFootprint.has(cellKey(roof)));
    if (overhang.length) {
      findings.push({
        check: 'coherent-buildings',
        id: 'coherent-buildings/roof-overhang',
        severity: 'low',
        message: `${overhang.length} roof piece(s) sit outside the footprint: ${at(overhang)}`,
        cells: overhang.map((piece) => ({ x: piece.x, y: piece.y })),
        objects: overhang.map((piece) => piece.key),
      });
    }
  }
  const measured = !pieces.some((piece) => piece.role === 'wall' && !piece.edge);
  const orphans = loose.filter((piece) => piece.role !== 'opening' && !claimed.has(piece));
  if (measured && orphans.length) {
    findings.push({
      check: 'coherent-buildings',
      id: 'coherent-buildings/no-shell',
      severity: 'high',
      message: `${orphans.length} roof or door piece(s) stand without any wall shell: ${at(orphans)}`,
      cells: orphans.map((piece) => ({ x: piece.x, y: piece.y })),
      objects: orphans.map((piece) => piece.key),
    });
  }
  return findings;
}
