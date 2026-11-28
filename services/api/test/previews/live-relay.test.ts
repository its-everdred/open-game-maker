import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { mintPreviewToken } from '../../src/builds/preview-token.js';
import { scanPreviewRelay } from '../../src/previews/relay.js';
import { liveWorkspaceReady } from '../../src/previews/live-workspace.js';
import { readTrack } from '../../src/review-rounds/tracks.js';
import { submitRelayedReview } from '../../src/review-rounds/relay.js';
import { ids, world } from '../builds/fixtures.js';

it('posts a live gameplay round from a granted workspace without an uploaded build or daemon', async () => {
  const home = mkdtempSync(join(tmpdir(), 'live-relay-'));
  try {
    const { deps } = world();
    deps.db
      .update(schema.games)
      .set({ slug: 'demo', githubOwner: 'example', githubRepo: 'games', githubPath: 'games/demo' })
      .where(eq(schema.games.id, ids.game))
      .run();
    const workspace = join(home, 'workspace');
    const trackDir = join(workspace, 'games/demo/review/tracks');
    mkdirSync(trackDir, { recursive: true });
    writeFileSync(
      join(trackDir, 'game.json'),
      JSON.stringify({
        id: 'game',
        category: 'gameplay',
        phases: [{ id: 'prototype', ticket: '12', template: 'next' }],
      }),
    );
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', workspace, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args], {
        encoding: 'utf8',
      }).trim();
    git('init', '-q');
    git('add', 'games');
    git('commit', '-qm', 'track');
    const sha = git('rev-parse', 'HEAD');
    const live = join(workspace, 'games/demo/.gm/live');
    const version = randomUUID();
    mkdirSync(join(live, 'versions', version, 'design'), { recursive: true });
    writeFileSync(join(live, 'versions', version, 'index.html'), '<title>Demo</title>');
    writeFileSync(join(live, 'versions', version, 'design/design.json'), '{}');
    symlinkSync(`versions/${version}`, join(live, 'current'));
    const repo = 'example/games';
    const secret = 'fixture-secret';
    const grant = randomUUID();
    const repoRoot = join(home, '.config/ogm/preview-repos', createHash('sha256').update(repo).digest('hex'));
    mkdirSync(join(repoRoot, 'grants'), { recursive: true });
    writeFileSync(join(repoRoot, 'secret'), secret);
    writeFileSync(
      join(repoRoot, 'grants', `${createHash('sha256').update(workspace).digest('hex')}.json`),
      JSON.stringify({ repo, ticket: '12', game: 'demo', workspace, grant }),
    );
    const requestDir = join(workspace, '.gm/preview');
    mkdirSync(requestDir, { recursive: true });
    const id = randomUUID();
    const request = randomUUID();
    const submission = {
      id,
      ticket: '12',
      sha,
      track: 'game',
      phase: 'prototype',
      category: 'gameplay',
      question: 'Does it feel right?',
      media: [{ kind: 'build', ref: `live-${id}`, scenario: 'yard' }],
    };
    expect(await liveWorkspaceReady(workspace, 'games/demo')).toBe(true);
    const track = await readTrack(workspace, 'games/demo', sha, 'game');
    expect(track.id).toBe('game');
    expect(
      await submitRelayedReview(deps, 'demo', repo, submission, undefined, async () => ({ id, round: 1 }), true, track),
    ).toEqual({ id, round: 1 });
    writeFileSync(
      join(requestDir, `${request}.json`),
      JSON.stringify({
        state: 'pending',
        kind: 'review',
        ticket: '12',
        slug: 'demo',
        sha,
        branch: 'main',
        token: mintPreviewToken(secret, '12', grant, 'demo'),
        submission,
      }),
    );
    await scanPreviewRelay(deps, home, async () => true);
    expect(JSON.parse(readFileSync(join(requestDir, `${request}.response`), 'utf8'))).toMatchObject({
      state: 'done',
      id,
    });
    expect(deps.db.select().from(schema.reviewRounds).get()).toMatchObject({ id, ticket: '12' });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
