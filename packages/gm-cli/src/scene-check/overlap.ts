import type { Grid } from './grid.js';
import { DRESSING, RUN, cellKey, type Finding, type Piece, type Role, type Scene } from './model.js';

const FLAT: ReadonlySet<Role> = new Set(['ground', 'path', 'roof']);
/** Share of the smaller sprite's measured alpha box that may overlap a neighbour in the same depth band. */
export const OVERLAP_LIMIT = 0.25;

/** A piece's alpha box in projected screen pixels, using the pack's anchor rule. */
export function screenBox(scene: Scene, piece: Piece): [number, number, number, number] | undefined {
  if (!piece.alpha || !piece.size) return undefined;
  const [tw, th] = scene.tile;
  const px = ((piece.x - piece.y) * tw) / 2;
  const py = ((piece.x + piece.y) * th) / 2 - piece.elevation * th;
  const scale = piece.scale ?? 1;
  const [l, t, r, b] = piece.alpha;
  return [
    px + (l - piece.size[0] / 2) * scale,
    py + (t - scene.anchorY) * scale,
    px + (r + 1 - piece.size[0] / 2) * scale,
    py + (b + 1 - scene.anchorY) * scale,
  ];
}

/** Props never share a cell or interpenetrate on screen, and characters never start inside a solid. */
export function noOverlap(grid: Grid): Finding[] {
  const findings: Finding[] = [];
  for (const [key, pieces] of grid.byCell) {
    const props = pieces.filter((piece) => DRESSING.has(piece.role) || piece.role === 'post');
    if (props.length < 2) continue;
    const [x, y] = key.split(',').map(Number);
    findings.push({
      check: 'no-overlap',
      id: 'no-overlap/shared-cell',
      severity: 'high',
      message: `${props.length} props share cell (${x},${y}): ${props.map((p) => p.asset).join(', ')}`,
      cells: [{ x: x!, y: y! }],
      objects: props.map((piece) => piece.key),
    });
  }
  const standing = grid.scene.pieces.filter((piece) => !FLAT.has(piece.role));
  const boxed = standing
    .map((piece) => ({ piece, box: screenBox(grid.scene, piece) }))
    .filter((entry): entry is { piece: Piece; box: [number, number, number, number] } => !!entry.box);
  const unboxed = [...new Set(standing.filter((piece) => !piece.alpha || !piece.size).map((piece) => piece.asset))];
  if (unboxed.length) {
    findings.push({
      check: 'facts',
      id: 'facts/unmeasured-alpha',
      severity: 'info',
      message: `${unboxed.length} asset(s) have no measured alpha bounds, so their on-screen overlap is unchecked`,
      cells: [],
      objects: unboxed,
    });
  }
  for (let i = 0; i < boxed.length; i++) {
    for (let j = i + 1; j < boxed.length; j++) {
      const a = boxed[i]!;
      const b = boxed[j]!;
      if (a.piece.x + a.piece.y !== b.piece.x + b.piece.y || cellKey(a.piece) === cellKey(b.piece)) continue;
      if (RUN.has(a.piece.role) && RUN.has(b.piece.role)) continue; // run pieces are drawn to overlap at joints
      const w = Math.min(a.box[2], b.box[2]) - Math.max(a.box[0], b.box[0]);
      const h = Math.min(a.box[3], b.box[3]) - Math.max(a.box[1], b.box[1]);
      if (w <= 0 || h <= 0) continue;
      const area = (box: number[]) => (box[2]! - box[0]!) * (box[3]! - box[1]!);
      const share = (w * h) / Math.min(area(a.box), area(b.box));
      if (share <= OVERLAP_LIMIT) continue;
      findings.push({
        check: 'no-overlap',
        id: 'no-overlap/interpenetrate',
        severity: 'medium',
        message: `${a.piece.asset} and ${b.piece.asset} overlap ${Math.round(share * 100)}% on screen in one depth band`,
        cells: [
          { x: a.piece.x, y: a.piece.y },
          { x: b.piece.x, y: b.piece.y },
        ],
        objects: [a.piece.key, b.piece.key],
      });
    }
  }
  for (const actor of grid.scene.actors) {
    if (!grid.blocked.has(cellKey(actor))) continue;
    findings.push({
      check: 'no-overlap',
      id: 'no-overlap/actor-in-solid',
      severity: 'high',
      message: `${actor.name} stands inside a solid piece at (${actor.x},${actor.y}): ${grid
        .at(actor)
        .filter((piece) => piece.solid && !FLAT.has(piece.role))
        .map((piece) => piece.asset)
        .join(', ')}`,
      cells: [{ x: actor.x, y: actor.y }],
      objects: [actor.id],
    });
  }
  return findings;
}
