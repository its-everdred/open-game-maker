import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import { readTrack, reviewCheckout } from '../../src/review-rounds/tracks.js';

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
      JSON.stringify({ id: 'art', category: 'art', phases: [{ id: 'concept', ticket: '42', template: 'asset-pack' }] }),
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

it('fetches a pushed review track absent from the daemon checkout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ogm-track-fetch-'));
  try {
    const remote = join(root, 'remote.git');
    const worker = join(root, 'worker');
    const daemon = join(root, 'daemon');
    execFileSync('git', ['init', '--bare', '-q', remote]);
    execFileSync('git', ['clone', '-q', remote, worker]);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', worker, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], {
        encoding: 'utf8',
      }).trim();
    writeFileSync(join(worker, 'README'), 'initial');
    git('add', 'README');
    git('commit', '-qm', 'initial');
    execFileSync('git', ['--git-dir', remote, 'fetch', '-q', worker, 'HEAD:refs/heads/main']);
    execFileSync('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
    execFileSync('git', ['clone', '-q', remote, daemon]);
    mkdirSync(join(worker, 'games/sample/review/tracks'), { recursive: true });
    writeFileSync(
      join(worker, 'games/sample/review/tracks/art.json'),
      JSON.stringify({ id: 'art', category: 'art', phases: [{ id: 'mock', ticket: '42', template: 'mock' }] }),
    );
    git('add', 'games');
    git('commit', '-qm', 'track');
    const sha = git('rev-parse', 'HEAD');
    execFileSync('git', ['--git-dir', remote, 'fetch', '-q', worker, 'HEAD:refs/heads/review-42']);
    expect((await readTrack(daemon, 'games/sample', sha, 'art')).phases[0]?.id).toBe('mock');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('finds the ticket checkout under a fleet daemon directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ogm-track-workspace-'));
  try {
    const workspace = join(root, 'workspaces', 'owner', 'repo', '42');
    mkdirSync(workspace, { recursive: true });
    execFileSync('git', ['init', '-q', workspace]);
    expect(await reviewCheckout(root, '42', 'owner/repo')).toBe(workspace);
    await expect(reviewCheckout(root, '../other', 'owner/repo')).rejects.toThrow('invalid_ticket');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
