import { schema } from '@ogm/db';
import type { AiurClient } from '@ogm/aiur-client';
import { HttpError } from '../../src/app/errors.js';
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
    deps.aiurClientForGame = async () =>
      ({ state, progress: async () => ({ progress: { status: 'known', percent: 50 } }) }) as unknown as AiurClient;
    const { app } = await makeApp(deps);
    const denied = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(outsider) });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(state).not.toHaveBeenCalled();
    const response = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workers: [{ ticket: '12', title: 'Forest backdrop', percent: 50, etaSeconds: 10, source: 'daemon' }],
    });
    deps.aiurClientForGame = async () => {
      throw new HttpError(409, 'daemon_not_found');
    };
    const noDaemon = await app.request(`/api/v1/games/${game}/workers`, { headers: asUser(user) });
    expect(await noDaemon.json()).toEqual({ workers: [] });
  });
});
