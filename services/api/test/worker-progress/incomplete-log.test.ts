import { schema } from '@ogm/db';
import { expect, it, vi } from 'vitest';
import { HttpError } from '../../src/app/errors.js';
import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';

const family = 'f_61000000-0000-4000-8000-000000000001';
const user = 'u_61000000-0000-4000-8000-000000000001';
const game = 'g_61000000-0000-4000-8000-000000000001';
const at = '2026-11-01T00:00:00.000Z';

// Kevin (#1296): the editor showed "Could not load all build updates" with no way to tell which source failed. The
// creator no longer sees that line, so the log must name the game and the failing source instead.
it("logs which source left a game's build list incomplete", async () => {
  const deps = makeDeps();
  deps.db.insert(schema.families).values({ id: family, name: 'Family', ownerUserId: user, createdAt: at }).run();
  deps.db
    .insert(schema.familyMembers)
    .values({ familyId: family, userId: user, role: 'owner', capability: 'creator', joinedAt: at })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: game,
      familyId: family,
      ownerId: user,
      title: 'Helm',
      slug: 'helm',
      githubOwner: 'owner',
      githubRepo: 'repo',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: at,
    })
    .run();
  installUsers(deps, [
    {
      kind: 'user',
      userId: user,
      familyId: family,
      platformRole: 'none',
      capability: 'creator',
      email: 'owner@example.test',
    },
  ]);
  const ticket = {
    ticket: '12',
    title: 'Active',
    labels: ['game:helm'],
    closedAt: null,
    updatedAt: at,
    outcome: 'Closed',
    url: 'https://example.test/12',
  };
  deps.registry.trackerTickets = async () => ({ stale: false, tickets: [ticket] });
  deps.aiurClientForGame = async () => {
    throw new HttpError(503, 'daemon_unreachable');
  };
  const log = vi.fn();
  deps.log = log;
  const { app } = await makeApp(deps);

  const broken = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
  expect(await broken.json()).toMatchObject({ daemonUnavailable: true });
  expect(log).toHaveBeenCalledWith({ event: 'game_workers_incomplete', gameId: game, daemon: 'daemon_unreachable' });
  // The app polls every 5 seconds: a lasting failure is one line, not one per poll.
  log.mockClear();
  await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
  expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'game_workers_incomplete' }));

  deps.registry.trackerTickets = async () => ({ stale: true, tickets: [ticket] });
  deps.aiurClientForGame = async () =>
    ({ state: async () => ({ running: [] }) }) as unknown as Awaited<ReturnType<typeof deps.aiurClientForGame>>;
  deps.registry.trackerTicket = async () => ticket;
  log.mockClear();
  await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
  expect(log).toHaveBeenCalledWith({ event: 'game_workers_incomplete', gameId: game, tracker: 'stale' });

  deps.registry.trackerTickets = async () => ({ stale: false, tickets: [] });
  deps.aiurClientForGame = async () =>
    ({
      state: async () => ({ running: [{ issue_identifier: '13', state: 'in-progress' }] }),
      progress: async () => ({ progress: { status: 'unknown' } }),
    }) as unknown as Awaited<ReturnType<typeof deps.aiurClientForGame>>;
  deps.registry.trackerTicket = async () => {
    throw new Error('Ticket lookup failed (502)');
  };
  log.mockClear();
  await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
  expect(log).toHaveBeenCalledWith({ event: 'game_workers_incomplete', gameId: game, lookup: 1 });

  deps.registry.trackerTickets = async () => ({ stale: false, tickets: [ticket] });
  deps.registry.trackerTicket = async () => ticket;
  log.mockClear();
  const healthy = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
  expect(await healthy.json()).toMatchObject({ daemonUnavailable: false, trackerStale: false });
  expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'game_workers_incomplete' }));
});
