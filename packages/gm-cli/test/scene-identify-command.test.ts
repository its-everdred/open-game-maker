import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { run } from '../src/cli.js';

it('prints candidates bound to the actual mock file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scene-identify-'));
  try {
    const mock = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#000' } })
      .png()
      .toBuffer();
    const sha = createHash('sha256').update(mock).digest('hex');
    const vector = { model: 'test', vector: [1, 0] };
    await writeFile(join(dir, 'mock.png'), mock);
    await writeFile(
      join(dir, 'brief.json'),
      JSON.stringify({
        image: { width: 2, height: 2 },
        story: 'A grave.',
        mood: 'Dusk',
        light: 'Warm',
        focalRegion: 'grave',
        regions: [{ id: 'grave', label: 'Grave', layer: 'prop', bounds: { x: 0, y: 0, width: 2, height: 2 } }],
      }),
    );
    await writeFile(
      join(dir, 'match.json'),
      JSON.stringify({
        mock_sha256: sha,
        scope: { pack: 'pack', kind: 'sprite', facing: 'E' },
        query: vector,
        candidates: [{ id: 'stone', source_sha256: sha, ...vector }],
        examined: 1,
        eligible: 1,
        truncated: false,
        regions: [{ crop: [0, 0, 2, 2], query: vector }],
      }),
    );
    const lines: string[] = [];
    expect(
      await run(['scene', 'identify', 'mock.png', 'brief.json', 'match.json'], {
        cwd: dir,
        env: {},
        out: (line) => lines.push(line),
      }),
    ).toBe(0);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({
      mockSha256: sha,
      complete: true,
      regions: [{ candidates: [{ id: 'stone', sourceSha256: sha }], review: 'pending' }],
    });
    const errors: string[] = [];
    const again = () =>
      run(['scene', 'identify', 'mock.png', 'brief.json', 'match.json'], {
        cwd: dir,
        env: {},
        err: (line) => errors.push(line),
      });
    const saved = await readFile(join(dir, 'match.json'));
    await writeFile(join(dir, 'match.json'), '{');
    expect(await again()).toBe(1);
    expect(errors.pop()).toMatch(/^invalid JSON/);
    await writeFile(join(dir, 'match.json'), saved);
    await writeFile(
      join(dir, 'mock.png'),
      await sharp({ create: { width: 3, height: 2, channels: 4, background: '#000' } })
        .png()
        .toBuffer(),
    );
    expect(await again()).toBe(1);
    expect(errors.pop()).toContain('brief image is 2x2 but the mock is 3x2');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
