import { segments, terminals, vertexIndex, type Grid } from './grid.js';
import {
  NEIGHBORS,
  across,
  cellKey,
  segment,
  type CellEdge,
  type Facing,
  type Finding,
  type Piece,
  type Role,
} from './model.js';

const RUN: ReadonlySet<Role> = new Set(['fence', 'wall', 'door', 'opening']);

/**
 * Every facing is one the asset ships; an edge piece faces along its run (a fence turned across its run draws
 * an edge no neighbour shares); a door opens onto a walkable cell.
 */
export function facing(grid: Grid): Finding[] {
  const findings: Finding[] = [];
  const pieces = grid.scene.pieces;
  for (const piece of pieces) {
    if (!piece.facings || piece.facings.includes(piece.facing)) continue;
    findings.push({
      check: 'facing',
      id: 'facing/unshipped',
      severity: 'high',
      message: `${piece.asset} has no ${piece.facing} facing (ships ${piece.facings.join(', ') || 'none'})`,
      cells: [{ x: piece.x, y: piece.y }],
      objects: [piece.key],
    });
  }
  const parts = segments(pieces, RUN);
  const index = vertexIndex(parts);
  const terminal = terminals(pieces);
  // Open ends of a candidate segment for this piece, counting every other run piece's joints.
  const openEnds = (piece: Piece, edge: CellEdge) => {
    const candidate = segment(piece, edge);
    return [candidate.a, candidate.b].filter((end) => {
      const key = cellKey(end);
      return (
        !terminal.has(key) && !(index.get(key) ?? []).some((part) => part.piece !== piece && part.key !== candidate.key)
      );
    }).length;
  };
  for (const { piece } of parts) {
    if ((piece.role !== 'fence' && piece.role !== 'wall') || !piece.edges) continue;
    const now = openEnds(piece, piece.edge!);
    if (!now) continue;
    const better = (Object.entries(piece.edges) as [Facing, CellEdge][])
      .filter(([name]) => name !== piece.facing)
      .map(([name, edge]) => ({ name, open: openEnds(piece, edge) }))
      .filter((option) => option.open < now)
      .sort((a, b) => a.open - b.open)[0];
    if (!better) continue;
    findings.push({
      check: 'facing',
      id: 'facing/across-run',
      severity: 'medium',
      message: `${piece.role} at (${piece.x},${piece.y}) faces ${piece.facing}, across its run; facing ${better.name} joins its neighbours`,
      cells: [{ x: piece.x, y: piece.y }],
      objects: [piece.key],
    });
  }
  for (const piece of pieces) {
    if (piece.role !== 'door') continue;
    const fronts = piece.edge
      ? [across(piece, piece.edge)]
      : NEIGHBORS.map(([dx, dy]) => ({ x: piece.x + dx, y: piece.y + dy }));
    if (fronts.some((cell) => grid.walkable(cell))) continue;
    findings.push({
      check: 'facing',
      id: 'facing/door-blocked',
      severity: 'high',
      message: `door at (${piece.x},${piece.y}) opens onto no walkable cell`,
      cells: [{ x: piece.x, y: piece.y }, ...fronts],
      objects: [piece.key],
    });
  }
  return findings;
}
