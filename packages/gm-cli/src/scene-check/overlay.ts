import type { SceneReport } from './report.js';
import { cellKey, segment, type Cell, type Scene } from './model.js';

const W = 64;
const H = 32;
const COLOR = { high: '#e0203a', medium: '#f08c00', low: '#e6c700', info: '#4a90d9' } as const;
const ROLE_FILL: Record<string, string> = { path: '#c8b48a', ground: '#9fb48a' };

/** A schematic top-down iso diagram of the scene with every finding outlined and numbered by rank, as SVG. */
export function overlaySvg(scene: Scene, report: SceneReport): string {
  const b = scene.bounds;
  const ox = (b.maxY - b.minY + 2) * (W / 2);
  const point = ({ x, y }: Cell) => [
    ox + (x - b.minX - (y - b.minY)) * (W / 2),
    H + (x - b.minX + (y - b.minY)) * (H / 2),
  ];
  const diamond = (cell: Cell) => {
    const [x, y] = point(cell);
    return `${x},${y} ${x! + W / 2},${y! + H / 2} ${x},${y! + H} ${x! - W / 2},${y! + H / 2}`;
  };
  const width = (b.maxX - b.minX + b.maxY - b.minY + 4) * (W / 2);
  const height = (b.maxX - b.minX + b.maxY - b.minY + 4) * (H / 2) + 2 * H;
  const out: string[] = [`<rect width="${width}" height="${height}" fill="#1b1b22"/>`];
  const roofs = new Set<string>();
  for (const piece of scene.pieces) {
    if (piece.role === 'ground' || piece.role === 'path')
      out.push(`<polygon points="${diamond(piece)}" fill="${ROLE_FILL[piece.role] ?? '#9fb48a'}"/>`);
    if (piece.role === 'roof') roofs.add(cellKey(piece));
  }
  for (const key of roofs) {
    const [x, y] = key.split(',').map(Number);
    out.push(`<polygon points="${diamond({ x: x!, y: y! })}" fill="#a0402a" fill-opacity="0.45"/>`);
  }
  // Outlines go under the pieces so runs stay visible; ranks sharing a cell print as one label.
  const labels = new Map<string, number[]>();
  for (const finding of [...report.findings].reverse()) {
    const color = COLOR[finding.severity];
    // Low and info findings get a label only: outlining every bare patch would hide the map.
    const outlined = finding.severity === 'high' || finding.severity === 'medium' ? finding.cells : [];
    for (const cell of outlined) {
      out.push(
        `<polygon points="${diamond(cell)}" fill="none" stroke="${color}" stroke-width="${finding.severity === 'high' ? 3 : 2}"/>`,
      );
    }
    const first = finding.cells[0];
    if (first) labels.set(cellKey(first), [finding.rank, ...(labels.get(cellKey(first)) ?? [])]);
  }
  const marks: string[] = [];
  for (const piece of scene.pieces) {
    const [x, y] = point(piece);
    if (piece.edge) {
      const { a, b: end } = segment(piece, piece.edge);
      const [x1, y1] = point(a);
      const [x2, y2] = point(end);
      const stroke = piece.role === 'fence' ? '#d08a3a' : piece.role === 'door' ? '#2a6bd9' : '#e8e8e8';
      marks.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/>`,
      );
    } else if (piece.role === 'door' || piece.role === 'opening' || piece.role === 'post') {
      marks.push(
        `<rect x="${x! - 5}" y="${y! + H / 2 - 5}" width="10" height="10" fill="${piece.role === 'post' ? '#e8e8e8' : '#2a6bd9'}"/>`,
      );
    } else if (piece.role !== 'ground' && piece.role !== 'path' && piece.role !== 'roof') {
      marks.push(
        `<circle cx="${x}" cy="${y! + H / 2}" r="${piece.solid ? 7 : 5}" fill="${piece.solid ? '#2d5a27' : '#7ec850'}"/>`,
      );
    }
  }
  for (const actor of scene.actors) {
    const [x, y] = point(actor);
    marks.push(`<polygon points="${x},${y! + 4} ${x! + 9},${y! + H - 4} ${x! - 9},${y! + H - 4}" fill="#c050f0"/>`);
  }
  out.push(...marks);
  for (const [key, ranks] of labels) {
    const [cx, cy] = key.split(',').map(Number);
    const [x, y] = point({ x: cx!, y: cy! });
    const color = COLOR[report.findings[ranks[0]! - 1]!.severity];
    out.push(
      `<text x="${x}" y="${y! + H / 2 + 6}" text-anchor="middle" font-family="monospace" font-size="16" font-weight="bold" fill="${color}" stroke="#000" stroke-width="3" paint-order="stroke">${ranks.join(',')}</text>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${out.join('')}</svg>`;
}
