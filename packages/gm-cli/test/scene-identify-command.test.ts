import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { run } from '../src/cli.js';

it('prints candidates bound to the actual mock file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scene-identify-'));
  try {
    const mock = Buffer.from('mock');
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
    await writeFile(join(dir, 'mock.png'), 'changed');
    await expect(
      run(['scene', 'identify', 'mock.png', 'brief.json', 'match.json'], { cwd: dir, env: {} }),
    ).rejects.toThrow('different mock');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
