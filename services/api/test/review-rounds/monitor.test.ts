import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import type { AiurClient } from '@ogm/aiur-client';
import { expect, it, vi } from 'vitest';
import { inspectReviewOwners } from '../../src/review-rounds/monitor.js';
import { reviewStalls } from '../../src/review-rounds/stalls.js';
import { postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it('alarms for a review owner with no open round and clears it when one is posted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ogm-review-owner-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args]);
    git('init', '-q');
    mkdirSync(join(root, 'games', 'fixture', 'review', 'tracks'), { recursive: true });
    writeFileSync(
      join(root, 'games', 'fixture', 'review', 'tracks', 'art.json'),
      JSON.stringify({ id: 'art', category: 'art', phases: [{ id: 'concept', ticket: '42', template: 'art' }] }),
    );
    git('add', 'games');
    git('commit', '-qm', 'track');
    const deps = makeDeps();
    seedDesignGame(deps);
    deps.db
      .update(schema.games)
      .set({ slug: 'fixture', githubPath: 'games/fixture', githubOwner: 'owner', githubRepo: 'repo' })
      .where(eq(schema.games.id, GAME))
      .run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'fixture',
        repo: 'owner/repo',
        checkoutPath: root,
        unit: 'fixture',
        envFile: '/fixture',
        port: 23456,
        status: 'running',
        createdAt: '2026-01-01T00:00:00Z',
      })
      .run();
    const client = {
      issue: async () => ({ status: 'idle', idle: { state: 'human-review' } }),
    } as unknown as AiurClient;
    const log = vi.fn();
    const input = { db: deps.db, clientForGame: async () => client, log, now: () => '2026-01-01T00:00:00Z' };
    await inspectReviewOwners(input);
    await inspectReviewOwners(input);
    expect(log).toHaveBeenCalledOnce();
    expect(reviewStalls(deps.db, 0).missing).toMatchObject([{ gameId: GAME, ticket: '42' }]);
    postRound(deps.db, {
      id: 'r',
      gameId: GAME,
      track: 'art',
      phase: 'concept',
      category: 'art',
      round: 1,
      ticket: '42',
      sha: 'a'.repeat(40),
      media: '[]',
      postedAt: '2026-01-01T00:00:00Z',
    });
    await inspectReviewOwners(input);
    expect(reviewStalls(deps.db, 0).missing).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
