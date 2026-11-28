import { homedir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { expect, it, vi } from 'vitest';
import type { FeedFleet } from '@ogm/builder';
import { createDaemonDirectory } from '../../src/jobs/daemons.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

const row = {
  repo: 'owner/repo',
  checkoutPath: '/fixture',
  unit: 'fixture',
  envFile: '/fixture',
  status: 'running' as const,
  createdAt: '2026-01-01T00:00:00Z',
};

// Dusk Helm (2026-11-21): `gm games register` shares the repository's daemon row instead of adding one, so a second
// game in the open-games repository had no row of its own. Its workers and Commands answered daemon_not_found, and
// the app showed "Could not load all build updates" and "Could not load all reviews" on every poll.
it('reaches the repository daemon a registered game shares, and never guesses between two', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  deps.db.update(schema.games).set({ githubOwner: 'Owner', githubRepo: 'Repo' }).where(eq(schema.games.id, GAME)).run();
  deps.db
    .insert(schema.gameDaemons)
    .values({ ...row, slug: 'first-game', port: 12345 })
    .run();
  const daemonFor = vi.fn(async (slug: string) => ({ client: { baseUrl: slug } }));
  const directory = createDaemonDirectory(deps.db, { daemonFor } as unknown as Pick<FeedFleet, 'daemonFor'>);

  expect((await directory.clientForGame(GAME)).baseUrl).toBe('first-game');

  // Two daemons serve the repository: the game's own is unknown, so it is refused rather than routed to either.
  deps.db
    .insert(schema.gameDaemons)
    .values({ ...row, slug: 'second-game', port: 12346 })
    .run();
  await expect(directory.clientForGame(GAME)).rejects.toMatchObject({ code: 'daemon_not_found' });

  // Another repository's daemon is never a fallback.
  deps.db.update(schema.games).set({ githubRepo: 'elsewhere' }).where(eq(schema.games.id, GAME)).run();
  deps.db.delete(schema.gameDaemons).where(eq(schema.gameDaemons.slug, 'second-game')).run();
  await expect(directory.clientForGame(GAME)).rejects.toMatchObject({ code: 'daemon_not_found' });
});

it('keeps a game on its own daemon when the repository has others', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  deps.db.update(schema.games).set({ githubOwner: 'owner', githubRepo: 'repo' }).where(eq(schema.games.id, GAME)).run();
  const slug = deps.db.select({ slug: schema.games.slug }).from(schema.games).where(eq(schema.games.id, GAME)).get()!
    .slug!;
  deps.db
    .insert(schema.gameDaemons)
    .values([
      { ...row, slug: 'other-game', port: 12345 },
      { ...row, slug, port: 12346 },
    ])
    .run();
  const daemonFor = vi.fn(async (name: string) => ({ client: { baseUrl: name } }));
  const directory = createDaemonDirectory(deps.db, { daemonFor } as unknown as Pick<FeedFleet, 'daemonFor'>);
  expect((await directory.clientForGame(GAME)).baseUrl).toBe(slug);
});

it('routes a new game to the registered daemon when managed rows share its repository', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  deps.db.update(schema.games).set({ githubOwner: 'owner', githubRepo: 'repo' }).where(eq(schema.games.id, GAME)).run();
  deps.db
    .insert(schema.gameDaemons)
    .values([
      { ...row, slug: 'registered', port: 12345 },
      { ...row, slug: 'managed', port: 12346, checkoutPath: join(homedir(), '.local/share/ogm/daemons/managed') },
    ])
    .run();
  const daemonFor = vi.fn(async (name: string) => ({ client: { baseUrl: name } }));
  const directory = createDaemonDirectory(deps.db, { daemonFor } as unknown as Pick<FeedFleet, 'daemonFor'>);
  expect((await directory.clientForGame(GAME)).baseUrl).toBe('registered');
});
