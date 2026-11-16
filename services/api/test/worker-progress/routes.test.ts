import { schema } from '@ogm/db';
import type { AiurClient } from '@ogm/aiur-client';
import { HttpError } from '../../src/app/errors.js';
import { postRound } from '../../src/review-rounds/store.js';
import { markReviewAnswered, observeReviewState } from '../../src/review-rounds/answer-guard.js';
import { describe, expect, it, vi } from 'vitest';
import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';

const family = 'f_60000000-0000-4000-8000-000000000001';
const user = 'u_60000000-0000-4000-8000-000000000001';
const outsider = 'u_60000000-0000-4000-8000-000000000002';
const otherFamily = 'f_60000000-0000-4000-8000-000000000002';
const game = 'g_60000000-0000-4000-8000-000000000001';
const at = '2026-11-01T00:00:00.000Z';

describe('worker progress route', () => {
  it('only exposes a game worker summary to an authorized creator', async () => {
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
        title: 'Game',
        slug: 'test-game',
        githubOwner: 'owner',
        githubRepo: 'shared',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: at,
      })
      .run();
    deps.db
      .insert(schema.aiurEvents)
      .values({
        daemonSlug: 'test-game',
        seq: 4,
        ticket: '11',
        topic: 'ticket.11.lifecycle.changed',
        payload: JSON.stringify({ lifecycle: 'completed', lifecycle_source: 'tracker' }),
        observedAt: at,
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
      {
        kind: 'user',
        userId: outsider,
        familyId: otherFamily,
        platformRole: 'none',
        capability: 'creator',
        email: 'other@example.test',
      },
    ]);
    const state = vi.fn().mockResolvedValue({
      running: [
        { issue_identifier: '12', title: 'Forest backdrop', runtime_seconds: 10, workspace_path: '/private/path' },
      ],
    });
    const progress = vi.fn().mockResolvedValue({ progress: { status: 'known', percent: 50 } });
    deps.aiurClientForGame = async () => ({ state, progress }) as unknown as AiurClient;
    const { app } = await makeApp(deps);
    const denied = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(outsider) });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(state).not.toHaveBeenCalled();
    const tracker = vi.fn(async (_repo, state: string) =>
      state === 'closed'
        ? {
            stale: false,
            tickets: [
              {
                ticket: '11',
                title: 'Done',
                outcome: 'Completed',
                closedAt: at,
                url: 'https://github.com/owner/shared/issues/11',
                labels: ['game:test-game'],
              },
              {
                ticket: '99',
                title: 'Other',
                outcome: 'Completed',
                closedAt: at,
                url: 'https://github.com/owner/shared/issues/99',
                labels: ['game:other'],
              },
            ],
          }
        : {
            stale: false,
            tickets: [
              {
                ticket: '12',
                title: 'Forest backdrop',
                outcome: 'Closed',
                closedAt: null,
                updatedAt: '2026-11-01T00:00:00Z',
                url: 'https://github.com/owner/shared/issues/12',
                labels: ['game:test-game', 'agent:ci-wait'],
              },
            ],
          },
    );
    deps.registry.trackerTickets = tracker;
    const deniedHistory = await app.request(`/api/v1/games/${game}/tickets/completed`, { headers: asUser(outsider) });
    expect(deniedHistory.status).toBeGreaterThanOrEqual(400);
    expect(tracker).not.toHaveBeenCalled();
    const historyResponse = await app.request(`/api/v1/games/${game}/tickets/completed`, { headers: asUser(user) });
    expect(await historyResponse.json()).toEqual({
      tickets: [
        {
          ticket: '11',
          title: 'Done',
          outcome: 'Completed',
          closedAt: at,
          url: 'https://github.com/owner/shared/issues/11',
          jobId: null,
        },
      ],
      stale: false,
    });
    const conversation = vi.fn().mockResolvedValue([{ text: 'A creator message' }]);
    deps.registry.ticketConversation = conversation;
    const otherConversation = await app.request(`/api/v1/games/${game}/tickets/99/conversation`, {
      headers: asUser(user),
    });
    expect(otherConversation.status).toBe(404);
    expect(conversation).not.toHaveBeenCalled();
    const ownConversation = await app.request(`/api/v1/games/${game}/tickets/11/conversation`, {
      headers: asUser(user),
    });
    expect(await ownConversation.json()).toEqual({ messages: [{ text: 'A creator message' }] });
    expect(conversation).toHaveBeenCalledWith({ owner: 'owner', name: 'shared' }, '11', ['test-game'], false);
    state.mockResolvedValue({
      running: [],
      idle: [{ issue_identifier: '12', title: 'Forest backdrop', runtime_seconds: 10, state: 'agent:ci-wait' }],
    });
    const response = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
    expect(await response.json()).toEqual({
      workers: [
        {
          ticket: '12',
          title: 'Forest backdrop',
          elapsedSeconds: 10,
          state: 'ci-wait',
          percent: null,
          etaSeconds: null,
          source: 'unknown',
        },
      ],
      daemonUnavailable: false,
      trackerStale: false,
      cursor: 4,
      completed: [{ ticket: '11', seq: 4, at }],
    });
    state.mockResolvedValue({ running: [{ issue_identifier: '12', title: 'Forest backdrop' }] });
    const resumed = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
    expect(await resumed.json()).toMatchObject({ workers: [{ ticket: '12', percent: 50, source: 'daemon' }] });
    progress.mockResolvedValueOnce({ progress: { status: 'unknown' } });
    const resumedUnknown = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
    expect(await resumedUnknown.json()).toMatchObject({
      workers: [{ ticket: '12', state: 'in-progress', percent: null, source: 'unknown' }],
    });
    state.mockResolvedValue({
      running: [
        { issue_identifier: '13', title: 'New game ticket' },
        { issue_identifier: '14', title: 'Other game ticket' },
      ],
    });
    deps.registry.trackerTicket = vi.fn(async (_repo, id) => ({
      ticket: id,
      title: id === '13' ? 'New game ticket' : 'Other game ticket',
      labels: [id === '13' ? 'game:test-game' : 'game:other'],
      closedAt: null,
      updatedAt: null,
      outcome: 'Closed',
      url: 'https://github.com/owner/shared/issues/' + id,
    }));
    const newWorker = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
    expect((await newWorker.json()).workers.map((worker: { ticket: string }) => worker.ticket)).toEqual(['13', '12']);
    const message = vi.fn().mockResolvedValue({ request_id: 'r' });
    const decisions = vi.fn().mockResolvedValue([]);
    deps.aiurClientForGame = async () => ({ decisions, message }) as unknown as AiurClient;
    tracker.mockImplementation(async () => ({
      stale: false,
      tickets: [
        {
          ticket: '12',
          title: 'Forest backdrop',
          outcome: 'Closed',
          closedAt: null,
          updatedAt: at,
          url: 'https://github.com/owner/shared/issues/12',
          labels: ['game:test-game', 'agent:human-review'],
        },
      ],
    }));
    const missing = `/api/v1/games/${game}/tickets/12/missing-review`;
    markReviewAnswered(deps.db, game, '12');
    expect((await app.request(missing, { method: 'POST', headers: asUser(user) })).status).toBe(409);
    expect(message).not.toHaveBeenCalled();
    observeReviewState(deps.db, game, '12', true);
    observeReviewState(deps.db, game, '12', false);
    expect((await app.request(missing, { method: 'POST', headers: asUser(outsider) })).status).toBeGreaterThanOrEqual(
      400,
    );
    expect(message).not.toHaveBeenCalled();
    expect((await app.request(missing, { method: 'POST', headers: asUser(user) })).status).toBe(200);
    expect(message).toHaveBeenCalledWith(
      '12',
      expect.stringContaining('no review media'),
      `review-target:12:${at}`,
      expect.any(AbortSignal),
    );
    decisions.mockRejectedValueOnce(new Error('daemon unavailable'));
    expect((await app.request(missing, { method: 'POST', headers: asUser(user) })).status).toBeGreaterThanOrEqual(500);
    expect(message).toHaveBeenCalledOnce();
    postRound(deps.db, {
      id: 'round',
      gameId: game,
      track: 'art',
      phase: 'concept',
      category: 'art',
      round: 1,
      ticket: '12',
      sha: 'a'.repeat(40),
      media: '[]',
      postedAt: at,
    });
    expect((await app.request(missing, { method: 'POST', headers: asUser(user) })).status).toBe(409);
    expect(message).toHaveBeenCalledOnce();
    // Restore the tracker snapshot for the unavailable-daemon check below.
    tracker.mockImplementation(async () => ({
      stale: false,
      tickets: [
        {
          ticket: '12',
          title: 'Forest backdrop',
          outcome: 'Closed',
          closedAt: null,
          updatedAt: '2026-11-01T00:00:00Z',
          url: 'https://github.com/owner/shared/issues/12',
          labels: ['game:test-game', 'agent:ci-wait'],
        },
      ],
    }));
    deps.aiurClientForGame = async () => {
      throw new HttpError(409, 'daemon_not_found');
    };
    const noDaemon = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
    expect(await noDaemon.json()).toEqual({
      workers: [
        {
          ticket: '12',
          title: 'Forest backdrop',
          state: 'ci-wait',
          percent: null,
          etaSeconds: null,
          source: 'unknown',
        },
      ],
      daemonUnavailable: true,
      trackerStale: false,
      cursor: 4,
      completed: [{ ticket: '11', seq: 4, at }],
    });
  });
});
