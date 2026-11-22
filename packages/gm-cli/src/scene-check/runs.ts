import { components, pieceCells, segments, terminals, vertexIndex, type Grid } from './grid.js';
import { cellKey, type Cell, type Finding, type Role } from './model.js';

const RUN: ReadonlySet<Role> = new Set(['fence', 'wall', 'door', 'opening']);

const parse = (key: string): Cell => {
  const [x, y] = key.split(',').map(Number);
  return { x: x!, y: y! };
};

/** Structural edge pieces without a measured edge cannot be checked; say so per asset instead of passing them. */
export function unmeasured(grid: Grid): Finding[] {
  const missing = new Map<string, Cell[]>();
  for (const piece of grid.scene.pieces) {
    if ((piece.role === 'fence' || piece.role === 'wall') && !piece.edge) {
      if (!missing.has(piece.asset)) missing.set(piece.asset, []);
      missing.get(piece.asset)!.push({ x: piece.x, y: piece.y });
    }
  }
  return [...missing].map(([asset, cells]) => ({
    check: 'facts',
    id: 'facts/unmeasured-edge',
    severity: 'info',
    message: `${cells.length} ${asset} piece(s) have no measured edge for their facing; runs and shells through them are unchecked`,
    cells,
    objects: [asset],
  }));
}

/**
 * Every fence or wall run is continuous: each end stops at a post, a building, a door or a declared gate.
 * Kevin rejected the churchyard because its fence pieces stood apart; a run end in the open is that defect.
 */
export function connectedRuns(grid: Grid): Finding[] {
  const parts = segments(grid.scene.pieces, RUN);
  const index = vertexIndex(parts);
  const terminal = terminals(grid.scene.pieces);
  const findings: Finding[] = [];
  const stacked = new Map<string, typeof parts>();
  for (const part of parts) stacked.set(part.key, [...(stacked.get(part.key) ?? []), part]);
  for (const group of stacked.values()) {
    if (group.length < 2) continue;
    findings.push({
      check: 'connected-runs',
      id: 'connected-runs/stacked',
      severity: 'medium',
      message: `${group.length} pieces draw the same grid edge`,
      cells: pieceCells(group),
      objects: group.map((part) => part.piece.key),
    });
  }
  const openEnds: Cell[] = [];
  for (const group of components(parts)) {
    if (group.every((part) => part.piece.role === 'door' || part.piece.role === 'opening')) continue;
    const ends = new Set<string>();
    for (const part of group) {
      for (const end of [part.a, part.b]) {
        const key = cellKey(end);
        if (new Set(index.get(key)!.map((p) => p.key)).size === 1 && !terminal.has(key)) ends.add(key);
      }
    }
    if (!ends.size) continue;
    const cells = [...ends].map(parse);
    openEnds.push(...cells);
    const role = group.find((part) => part.piece.role === 'fence' || part.piece.role === 'wall')!.piece.role;
    findings.push({
      check: 'connected-runs',
      id: 'connected-runs/open-end',
      severity: 'high',
      message:
        `${role} run of ${group.length} piece(s) ends in the open at ${cells.map((c) => `(${c.x},${c.y})`).join(' ')}` +
        `; end it at a post, corner, building or declared gate`,
      cells: [...pieceCells(group), ...cells],
      objects: group.map((part) => part.piece.key),
    });
  }
  const reported = new Set<string>();
  for (const a of openEnds) {
    for (const b of openEnds) {
      const pair = [cellKey(a), cellKey(b)].sort().join('|');
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1 || reported.has(pair)) continue;
      reported.add(pair);
      findings.push({
        check: 'connected-runs',
        id: 'connected-runs/gap',
        severity: 'high',
        message: `undeclared one-edge gap between (${a.x},${a.y}) and (${b.x},${b.y}); close it or tag the opening as a gate`,
        cells: [a, b],
        objects: [],
      });
    }
  }
  return findings;
}
