import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import type { GmContext } from '../src/command.js';
import { command } from '../src/commands/scene/compare-ground.js';

it('ranks registered ground regions and rejects out-of-image anchors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scene-compare-ground-'));
  try {
    const png = (pixels: number[]) =>
      sharp(Buffer.from(pixels), { raw: { width: 2, height: 2, channels: 3 } })
        .png()
        .toBuffer();
    await writeFile(join(dir, 'reference.png'), await png(Array(12).fill(255)));
    await writeFile(join(dir, 'render.png'), await png([255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]));
    const anchors = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ].map((point) => ({ reference: point, render: point }));
    const regions = [
      { id: 'same', bounds: { x: 0, y: 0, w: 1, h: 1 } },
      { id: 'different', bounds: { x: 1, y: 0, w: 1, h: 1 } },
    ];
    await writeFile(join(dir, 'registration.json'), JSON.stringify({ anchors, regions }));
    const lines: string[] = [];
    const args = ['reference.png', 'render.png', 'registration.json'];
    const ctx = { cwd: dir, out: (line: string) => lines.push(line) } as GmContext;
    expect(await command.run(ctx, args, {})).toBe(0);
    expect(JSON.parse(lines.join('\n')).regions.map((r: { id: string }) => r.id)).toEqual(['different', 'same']);
    await writeFile(
      join(dir, 'registration.json'),
      JSON.stringify({
        anchors: [{ reference: { x: 2, y: 0 }, render: { x: 0, y: 0 } }, ...anchors.slice(1)],
        regions,
      }),
    );
    await expect(command.run(ctx, args, {})).rejects.toThrow('outside its image');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
