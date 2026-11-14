import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { expect, it, vi } from 'vitest';
import type { FeedFleet } from '@ogm/builder';
import { reviewClientForGame, reviewDaemonForGame } from '../../src/review-rounds/daemon.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it('uses the unique repository daemon for a shared game and refuses ambiguous matches', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  deps.db.update(schema.games).set({ githubOwner: 'Owner', githubRepo: 'Repo' }).where(eq(schema.games.id, GAME)).run();
  const row = {
    repo: 'owner/repo',
    checkoutPath: '/fixture',
    unit: 'fixture',
    envFile: '/fixture',
    status: 'running' as const,
    createdAt: '2026-01-01T00:00:00Z',
  };
  deps.db
    .insert(schema.gameDaemons)
    .values({ ...row, slug: 'other-game', port: 12345 })
    .run();
  expect(reviewDaemonForGame(deps.db, GAME)?.slug).toBe('other-game');
  const daemonFor = vi.fn().mockResolvedValue({ client: { baseUrl: 'fixture' } });
  const clientFor = reviewClientForGame(deps.db, { daemonFor } as unknown as Pick<FeedFleet, 'daemonFor'>);
  expect((await clientFor(GAME)).baseUrl).toBe('fixture');
  expect(daemonFor).toHaveBeenCalledWith('other-game');
  deps.db
    .insert(schema.gameDaemons)
    .values({ ...row, slug: 'another-game', port: 12346 })
    .run();
  expect(reviewDaemonForGame(deps.db, GAME)).toBeUndefined();
  await expect(clientFor(GAME)).rejects.toThrow('review_daemon_unavailable');
  deps.db
    .insert(schema.gameDaemons)
    .values({ ...row, repo: 'other/repo', slug: 'lantern-bay', port: 12347 })
    .run();
  expect(reviewDaemonForGame(deps.db, GAME)).toBeUndefined();
});
