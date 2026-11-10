import { access } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';

import type { ResolvedCard } from './types.js';

export const SHEET_MAX = 24;
const CELL = 256;
const LABEL = 28;
const COLUMNS = 6;

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** `t1:kenney-mini-dungeon/character-orc@2.0` → `character-orc`. */
export function labelOf(id: string): string {
  return (id.split('/').at(-1) ?? id).replace(/^t\d:/, '').replace(/@.*$/, '');
}

async function previewPath(root: string, card: ResolvedCard): Promise<string | null> {
  for (const key of [card.previews?.thumb, card.previews?.sheet]) {
    if (!key) continue;
    const path = join(root, key);
    try {
      await access(path);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

async function cell(root: string, card: ResolvedCard): Promise<Buffer> {
  const isAiGenerated = card.generation?.method === 'ai';
  const ai = isAiGenerated
    ? `<rect x="218" y="4" width="32" height="20" rx="3" fill="#ffcf66"/>` +
      `<text x="225" y="19" font-family="sans-serif" font-size="13" font-weight="700" fill="#17141f">AI</text>`
    : '';
  const label = Buffer.from(
    `<svg width="${CELL}" height="${LABEL}"><rect width="100%" height="100%" fill="#202020"/>` +
      `<text x="6" y="19" font-family="sans-serif" font-size="15" fill="#f0f0f0">${escapeXml(labelOf(card.id).slice(0, isAiGenerated ? 24 : 30))}</text>${ai}</svg>`,
  );
  const path = await previewPath(root, card);
  const image = path
    ? await sharp(path).resize(CELL, CELL, { fit: 'contain', background: '#3a3a3a' }).png().toBuffer()
    : await sharp({ create: { width: CELL, height: CELL, channels: 3, background: '#808080' } })
        .png()
        .toBuffer();
  return sharp({ create: { width: CELL, height: CELL + LABEL, channels: 3, background: '#3a3a3a' } })
    .composite([
      { input: image, top: 0, left: 0 },
      { input: label, top: CELL, left: 0 },
    ])
    .png()
    .toBuffer();
}

/** Grid of existing preview images, one labelled cell per card (grey when a card has no preview), written as PNG. */
export async function writeSheet(root: string, cards: ResolvedCard[], out: string): Promise<{ cells: number }> {
  const chosen = cards.slice(0, SHEET_MAX);
  const columns = Math.min(COLUMNS, chosen.length);
  const rows = Math.ceil(chosen.length / columns);
  const cells = await Promise.all(chosen.map((card) => cell(root, card)));
  await sharp({
    create: { width: columns * CELL, height: rows * (CELL + LABEL), channels: 3, background: '#3a3a3a' },
  })
    .composite(
      cells.map((input, i) => ({ input, left: (i % columns) * CELL, top: Math.floor(i / columns) * (CELL + LABEL) })),
    )
    .png()
    .toFile(out);
  return { cells: chosen.length };
}
