import type { SceneReport } from './report.js';
import { cellKey, segment, type Cell, type Scene } from './model.js';

const W = 32;
const H = 16;
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
    if (piece.layer === 'floor')
      out.push(`<polygon points="${diamond(piece)}" fill="${ROLE_FILL[piece.role] ?? '#9fb48a'}"/>`);
    if (piece.role === 'roof') roofs.add(cellKey(piece));
  }
  for (const key of roofs) {
    const [x, y] = key.split(',').map(Number);
    out.push(`<polygon points="${diamond({ x: x!, y: y! })}" fill="#a0402a" fill-opacity="0.45"/>`);
  }
  for (const piece of scene.pieces) {
    const [x, y] = point(piece);
    if (piece.edge) {
      const { a, b: end } = segment(piece, piece.edge);
      const [x1, y1] = point(a);
      const [x2, y2] = point(end);
      const stroke = piece.role === 'fence' ? '#6b4a2a' : piece.role === 'door' ? '#2a6bd9' : '#e8e8e8';
      out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="3"/>`);
    } else if (piece.role === 'door' || piece.role === 'opening' || piece.role === 'post') {
      out.push(
        `<rect x="${x! - 3}" y="${y! + H / 2 - 3}" width="6" height="6" fill="${piece.role === 'post' ? '#e8e8e8' : '#2a6bd9'}"/>`,
      );
    } else if (piece.layer !== 'floor' && piece.role !== 'roof') {
      out.push(
        `<circle cx="${x}" cy="${y! + H / 2}" r="${piece.solid ? 4 : 3}" fill="${piece.solid ? '#2d5a27' : '#7ec850'}"/>`,
      );
    }
  }
  for (const actor of scene.actors) {
    const [x, y] = point(actor);
    out.push(`<polygon points="${x},${y! + 2} ${x! + 5},${y! + H - 2} ${x! - 5},${y! + H - 2}" fill="#c050f0"/>`);
  }
  for (const finding of [...report.findings].reverse()) {
    const color = COLOR[finding.severity];
    for (const cell of finding.cells) {
      out.push(`<polygon points="${diamond(cell)}" fill="none" stroke="${color}" stroke-width="2"/>`);
    }
    const first = finding.cells[0];
    if (!first) continue;
    const [x, y] = point(first);
    out.push(
      `<text x="${x! + 6}" y="${y! + 4}" font-family="monospace" font-size="11" font-weight="bold" fill="${color}" stroke="#000" stroke-width="0.6">${finding.rank}</text>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${out.join('')}</svg>`;
}
