import { components, pieceCells, segments, terminals, vertexIndex, type Grid } from './grid.js';
import { RUN, cellKey, type Cell, type Finding } from './model.js';

const parse = (key: string): Cell => {
  const [x, y] = key.split(',').map(Number);
  return { x: x!, y: y! };
};

/**
 * Structural edge pieces without a measured edge cannot be checked. They fail closed: a run nobody could check
 * is not a passing run, so the worker fixes the facts or lists the gap as a known limitation with --allow.
 */
export function unmeasured(grid: Grid): Finding[] {
  const missing = new Map<string, Cell[]>();
  const scaled = new Map<string, Cell[]>();
  const scaledRoofs = new Map<string, Cell[]>();
  const scaledPosts = new Map<string, Cell[]>();
  for (const piece of grid.scene.pieces) {
    if ((piece.role === 'fence' || piece.role === 'wall') && !piece.edge) {
      if (!missing.has(piece.asset)) missing.set(piece.asset, []);
      missing.get(piece.asset)!.push({ x: piece.x, y: piece.y });
    }
    if (RUN.has(piece.role) && piece.scale !== undefined && piece.scale !== 1) {
      if (!scaled.has(piece.asset)) scaled.set(piece.asset, []);
      scaled.get(piece.asset)!.push({ x: piece.x, y: piece.y });
    }
    if (piece.role === 'roof' && piece.scale !== undefined && piece.scale !== 1) {
      if (!scaledRoofs.has(piece.asset)) scaledRoofs.set(piece.asset, []);
      scaledRoofs.get(piece.asset)!.push({ x: piece.x, y: piece.y });
    }
    if (piece.role === 'post' && piece.scale !== undefined && piece.scale !== 1) {
      if (!scaledPosts.has(piece.asset)) scaledPosts.set(piece.asset, []);
      scaledPosts.get(piece.asset)!.push({ x: piece.x, y: piece.y });
    }
  }
  const missingFindings: Finding[] = [...missing].map(([asset, cells]) => ({
    check: 'facts',
    id: 'facts/unmeasured-edge',
    severity: 'high',
    message: `${cells.length} ${asset} piece(s) have no measured edge for their facing; runs and shells through them are unchecked`,
    cells,
    objects: [asset],
  }));
  return [
    ...missingFindings,
    ...[...scaled].map(([asset, cells]): Finding => ({
      check: 'facts',
      id: 'facts/scaled-edge',
      severity: 'high',
      message: `${cells.length} ${asset} piece(s) are scaled; their measured full-cell edges cannot establish a connected run`,
      cells,
      objects: [asset],
    })),
    ...[...scaledRoofs].map(([asset, cells]): Finding => ({
      check: 'facts',
      id: 'facts/scaled-roof',
      severity: 'high',
      message: `${cells.length} ${asset} roof piece(s) are scaled; their full-cell coverage cannot be assumed`,
      cells,
      objects: [asset],
    })),
    ...[...scaledPosts].map(([asset, cells]): Finding => ({
      check: 'facts',
      id: 'facts/scaled-post',
      severity: 'high',
      message: `${cells.length} ${asset} post(s) are scaled without an inspected socket; fence continuity is unchecked`,
      cells,
      objects: [asset],
    })),
  ];
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
  const openEnds: { cell: Cell; run: number }[] = [];
  for (const [run, group] of components(parts).entries()) {
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
    openEnds.push(...cells.map((cell) => ({ cell, run })));
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
  // Two different runs ending one edge apart: the missing piece between them is a gap, not a gate.
  for (const { cell: a, run } of openEnds) {
    for (const { cell: b, run: other } of openEnds) {
      const pair = [cellKey(a), cellKey(b)].sort().join('|');
      if (run === other || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1 || reported.has(pair)) continue;
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
