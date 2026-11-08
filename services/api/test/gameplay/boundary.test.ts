import { savesPath } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { setPaidApisDuringGameplay } from '../../src/gameplay/policy.js';
import { seededApp, X, Y } from '../admin-fixture.js';
import { asUser } from '../helpers.js';

type App = Awaited<ReturnType<typeof seededApp>>['app'];

const GAMES = 'https://games.example.test';
const APP = 'https://app.example.test';

// The creator renders narration for their own game; `headers` says where the browser says the request came from.
function narrate(app: App, headers: Record<string, string> = {}) {
  return app.request(`/api/v1/games/${X.game}/narration/render`, {
    method: 'POST',
    headers: { ...asUser(X.creator.userId), 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ lines: [{ id: 'l1', text: 'Hello' }] }),
  });
}

async function code(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { error?: string }).error;
}

describe('admin setting: paid APIs during gameplay', () => {
  it('is off until an instance admin turns it on', async () => {
    const { call } = await seededApp();
    expect(await (await call(X.admin, 'GET', '/gameplay')).json()).toEqual({ paidApisDuringGameplay: false });

    const patched = await call(X.admin, 'PATCH', '/gameplay', { paidApisDuringGameplay: true });
    expect(patched.status).toBe(200);
    // Instance-wide, not per family: another family's instance admin sees the same value.
    expect(await (await call(Y.admin, 'GET', '/gameplay')).json()).toEqual({ paidApisDuringGameplay: true });
  });

  it('refuses anyone who is not an instance admin, even the game owner', async () => {
    const { call, deps } = await seededApp();
    for (const user of [X.creator, X.player]) {
      const response = await call(user, 'PATCH', '/gameplay', { paidApisDuringGameplay: true });
      expect(response.status).toBe(403);
      expect((await call(user, 'GET', '/gameplay')).status).toBe(403);
    }
    expect(await (await call(X.admin, 'GET', '/gameplay')).json()).toEqual({ paidApisDuringGameplay: false });
    expect(deps.lines.filter((line) => line.event === 'gameplay_paid_apis_set')).toEqual([]);
  });

  it('accepts only the one boolean field', async () => {
    const { call } = await seededApp();
    expect((await call(X.admin, 'PATCH', '/gameplay', { paidApisDuringGameplay: 'yes' })).status).toBe(400);
    expect((await call(X.admin, 'PATCH', '/gameplay', { paidApisDuringGameplay: true, scope: 'g' })).status).toBe(400);
  });
});

describe('metered-service boundary', () => {
  it("rejects a game's request before dispatch while paid APIs are off", async () => {
    const { app } = await seededApp();
    const response = await narrate(app, { origin: GAMES });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('paid_apis_off_during_gameplay');
  });

  it('cannot be talked out of it by the client', async () => {
    const { app } = await seededApp();
    const attempts: Record<string, string>[] = [
      { origin: GAMES, 'x-ogm-purpose': 'development', 'x-ogm-paid-apis': 'on' },
      { origin: 'null' }, // a nested sandboxed frame
      { referer: `${GAMES}/g/${X.game}/b1/` }, // a request with no Origin from a game page
      { origin: 'https://elsewhere.example' },
    ];
    for (const headers of attempts) {
      const response = await narrate(app, headers);
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(await code(response)).toBe('paid_apis_off_during_gameplay');
    }
  });

  it("lets the editor's own requests through to dispatch", async () => {
    const { app } = await seededApp();
    // No renderer is wired in tests: 503 means the request passed the boundary and reached dispatch.
    for (const headers of [{ origin: APP }, {}]) {
      expect(await code(await narrate(app, headers))).toBe('narration_unavailable');
    }
  });

  it('lets gameplay through once an instance admin turns paid APIs on', async () => {
    const { app, deps } = await seededApp();
    setPaidApisDuringGameplay(deps.db, true);
    expect(await code(await narrate(app, { origin: GAMES }))).toBe('narration_unavailable');
  });

  it('guards voice tokens too', async () => {
    const { app } = await seededApp();
    const response = await app.request('/api/v1/voice/token', {
      method: 'POST',
      headers: { ...asUser(X.creator.userId), 'content-type': 'application/json', origin: GAMES },
      body: JSON.stringify({ target: { creator_id: X.creator.userId, game_id: X.game, job_id: 'j1' } }),
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('paid_apis_off_during_gameplay');
  });
});

describe('creation Energy and play', () => {
  // Energy pays for building; a finished game must stay playable when a member has none left.
  it('still lets a member with no Energy left play and save', async () => {
    const { app, deps } = await seededApp();
    deps.db.insert(schema.allowances).values({ familyId: X.family, userId: X.player.userId, dailyMicroUsd: 0 }).run();
    const response = await app.request(`/api/v1${savesPath(X.game)}/lease`, {
      method: 'POST',
      headers: { ...asUser(X.player.userId), 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'device_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        tabId: 'tab_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        takeover: false,
      }),
    });
    expect(response.status).toBe(200);
  });
});
