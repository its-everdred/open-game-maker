import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { buildIndex, labelOf, writeSheet } from '../src/index.js';
import { libraryCopy } from './helpers.js';

describe('writeSheet', () => {
  it('writes a labelled PNG grid, using a preview when it exists and grey otherwise', async () => {
    const root = libraryCopy();
    mkdirSync(join(root, 'previews/e0'), { recursive: true });
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } })
      .webp()
      .toFile(join(root, 'previews/e0/e0b021c98b34a633-thumb.webp'));
    const index = await buildIndex(root);
    const cards = index.cards.filter((card) => card.id.startsWith('t1:kenney-mini-dungeon/'));
    const out = join(mkdtempSync(join(tmpdir(), 'sheet-')), 'sheet.png');

    expect(await writeSheet(root, cards, out)).toEqual({ cells: 2 });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBeGreaterThan(meta.height ?? 0);

    const orcPixel = await sharp(out).extract({ left: 128, top: 128, width: 1, height: 1 }).raw().toBuffer();
    const wallPixel = await sharp(out)
      .extract({ left: 256 + 128, top: 128, width: 1, height: 1 })
      .raw()
      .toBuffer();
    // the red preview fills the orc cell (lossy webp, so allow a few levels); the wall has none and stays grey
    expect(orcPixel[0]).toBeGreaterThan(245);
    expect(Math.max(orcPixel[1], orcPixel[2])).toBeLessThan(10);
    expect([...wallPixel.subarray(0, 3)]).toEqual([128, 128, 128]);
  });

  it('labels cells with the id path segment', () => {
    expect(labelOf('t1:kenney-mini-dungeon/character-orc@2.0')).toBe('character-orc');
  });

  it('puts a visible AI badge on generated assets in a lineup', async () => {
    const root = libraryCopy();
    const index = await buildIndex(root);
    const card = index.cards.find((candidate) => candidate.id.startsWith('t1:kenney-mini-dungeon/'))!;
    const out = join(mkdtempSync(join(tmpdir(), 'sheet-ai-')), 'sheet.png');
    await writeSheet(root, [{ ...card, generation: { method: 'ai', tool: 'test generator' } }], out);
    const badgePixel = await sharp(out)
      .extract({ left: 246, top: 256 + 10, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect([...badgePixel.subarray(0, 3)]).toEqual([255, 207, 102]);
  });
});
