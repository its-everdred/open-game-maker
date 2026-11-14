import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import { readTrack } from '../../src/review-rounds/tracks.js';

it('reads the track definition at the submitted commit, not a later checkout edit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ogm-track-test-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], {
        encoding: 'utf8',
      }).trim();
    git('init', '-q');
    mkdirSync(join(root, 'games', 'sample', 'review', 'tracks'), { recursive: true });
    const file = join(root, 'games', 'sample', 'review', 'tracks', 'art.json');
    writeFileSync(
      file,
      JSON.stringify({ id: 'art', phases: [{ id: 'concept', ticket: '42', template: 'asset-pack' }] }),
    );
    git('add', 'games');
    git('commit', '-qm', 'track');
    const sha = git('rev-parse', 'HEAD');
    writeFileSync(file, '{}');
    expect((await readTrack(root, 'games/sample', sha, 'art')).phases[0]?.ticket).toBe('42');
    await expect(readTrack(root, '../other', sha, 'art')).rejects.toThrow('invalid_track_reference');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
