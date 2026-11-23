import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { ensureMainBranch } from '../src/design/store.js';
import { asUser, installUsers, INTERNAL_TOKEN, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-01T00:00:00.000Z';
const ids = {
  family: 'f_01K8Z6Y7X8P9Q0R1S2T3V4W5X6',
  creator: 'u_01K8Z6Y7X8P9Q0R1S2T3V4W5X7',
  other: 'u_01K8Z6Y7X8P9Q0R1S2T3V4W5X8',
  game: 'g_01K8Z6Y7X8P9Q0R1S2T3V4W5X9',
  build: 'build_01K8Z6Y7X8P9Q0R1S2T3V4W5XA',
} as const;

const creator: TestUser = {
  kind: 'user',
  userId: ids.creator,
  email: 'creator@example.test',
  familyId: ids.family,
  platformRole: 'none',
  capability: 'creator',
};
const other: TestUser = {
  kind: 'user',
  userId: ids.other,
  email: 'other@example.test',
  familyId: ids.family,
  platformRole: 'none',
  capability: 'creator',
};

async function setup() {
  const deps = makeDeps();
  installUsers(deps, [creator, other]);
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Household', ownerUserId: ids.creator, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values([
      { familyId: ids.family, userId: ids.creator, role: 'owner', capability: 'creator', joinedAt: now },
      { familyId: ids.family, userId: ids.other, role: 'member', capability: 'creator', joinedAt: now },
    ])
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.creator,
      title: 'Design API test',
      visibility: 'listed',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  const designDir = join(deps.config.gamesRoot, ids.game, ids.build, 'design');
  mkdirSync(designDir, { recursive: true });
  writeFileSync(
    join(designDir, 'design.json'),
    JSON.stringify({ schemaVersion: 1, globals: { gravity: 1 }, entities: {} }),
  );
  writeFileSync(
    join(deps.config.gamesRoot, ids.game, ids.build, 'manifest.json'),
    JSON.stringify({
      id: 'game',
      sdk: '^1.0.0',
      title: 'Game',
      inputs: { actions: {} },
      presentation: { orientation: 'any', minLogical: { w: 320, h: 180 }, fit: 'responsive' },
      view: 'topdown',
      dimension: '2d',
      capabilities: [],
      palette: { categories: [], items: [] },
      tools: [],
      gizmos: {},
      saves: false,
      overrides: { aliases: {}, retired: [] },
      controls: [
        {
          id: 'world.gravity',
          label: 'Gravity',
          scope: 'global',
          path: '/globals/gravity',
          widget: { kind: 'slider', min: 0, max: 10 },
          default: 1,
        },
      ],
    }),
  );
  const branch = ensureMainBranch(deps.sqlite, ids.game);
  deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.build, branch.id);
  return makeApp(deps);
}

const branchUrl = `/api/v1/games/${ids.game}/branches/main`;
const jsonHeaders = (userId = ids.creator) => ({ ...asUser(userId), 'content-type': 'application/json' });

function transaction(baseRev: number, token: number, sessionId: string, gravity: number) {
  return {
    baseRev,
    leaseToken: token,
    sessionId,
    kind: 'manual',
    label: `Set gravity to ${gravity}`,
    baseBuildId: ids.build,
    commands: [],
    patches: [{ op: 'replace', path: ['globals', 'gravity'], value: gravity }],
    inverse: [{ op: 'replace', path: ['globals', 'gravity'], value: gravity - 1 }],
  };
}

async function acquire(app: Awaited<ReturnType<typeof makeApp>>['app'], sessionId: string, userId = ids.creator) {
  const response = await app.request(`${branchUrl}/lease`, {
    method: 'POST',
    headers: jsonHeaders(userId),
    body: JSON.stringify({ sessionId }),
  });
  return { response, body: (await response.json()) as { token: number; expiresAt: string } };
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  complete: (text: string) => boolean,
): Promise<string> {
  let text = '';
  while (!complete(text)) {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('design SSE read timed out')), 1_500),
    );
    const next = await Promise.race([reader.read(), timeout]);
    text += new TextDecoder().decode(next.value);
  }
  return text;
}

describe('design log routes', () => {
  it('fences manual writes and reports stale heads without inserting a row', async () => {
    const { app } = await setup();
    const firstLease = await acquire(app, 'browser-one');
    expect(firstLease.response.status).toBe(200);

    const created = await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(transaction(0, firstLease.body.token, 'browser-one', 2)),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ rev: 1 });

    const stale = await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(transaction(0, firstLease.body.token, 'browser-one', 3)),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ headRev: 1 });

    const wrongToken = await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(transaction(1, firstLease.body.token + 1, 'browser-one', 3)),
    });
    expect(wrongToken.status).toBe(423);
    expect(await wrongToken.json()).toEqual({ holder: 'other-session' });

    const listed = await app.request(`${branchUrl}/transactions?after=0&format=json`, {
      headers: asUser(ids.creator),
    });
    expect((await listed.json()) as unknown[]).toHaveLength(1);
  });

  it('lets the same user take over while fencing the old session and refusing another user', async () => {
    const { app } = await setup();
    const first = await acquire(app, 'browser-one');
    const heartbeat = await app.request(`${branchUrl}/lease/heartbeat`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: 'browser-one', token: first.body.token }),
    });
    expect(heartbeat.status).toBe(200);
    const takeover = await acquire(app, 'browser-two');
    expect(takeover.response.status).toBe(200);
    expect(takeover.body.token).toBe(first.body.token + 1);

    const staleHeartbeat = await app.request(`${branchUrl}/lease/heartbeat`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: 'browser-one', token: first.body.token }),
    });
    expect(staleHeartbeat.status).toBe(423);

    const oldSession = await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(transaction(0, first.body.token, 'browser-one', 2)),
    });
    expect(oldSession.status).toBe(423);

    const forbidden = await acquire(app, 'other-browser', ids.other);
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.body).toEqual({ error: 'not_owner' });

    const released = await app.request(`${branchUrl}/lease`, {
      method: 'DELETE',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: 'browser-two', token: takeover.body.token }),
    });
    expect(released.status).toBe(204);
  });

  it('validates patches before commit and reconstructs a requested revision', async () => {
    const { app } = await setup();
    const lease = await acquire(app, 'browser-one');
    const invalid = await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        ...transaction(0, lease.body.token, 'browser-one', 2),
        patches: [{ op: 'add', path: ['secrets', 'token'], value: 'nope' }],
      }),
    });
    expect(invalid.status).toBe(422);

    const tooLarge = await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        ...transaction(0, lease.body.token, 'browser-one', 2),
        patches: [{ op: 'replace', path: ['globals', 'notes'], value: 'x'.repeat(300 * 1024) }],
      }),
    });
    expect(tooLarge.status).toBe(413);

    const invalidCommand = await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        ...transaction(0, lease.body.token, 'browser-one', 2),
        commands: [{ op: 'set', control: 'world.gravity', targets: 'global', value: 20 }],
      }),
    });
    expect(invalidCommand.status).toBe(422);

    const created = await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        ...transaction(0, lease.body.token, 'browser-one', 2),
        commands: [{ op: 'set', control: 'world.gravity', targets: 'global', value: 2 }],
      }),
    });
    expect(created.status).toBe(200);

    const snapshot = await app.request(`${branchUrl}/design?rev=1`, { headers: asUser(ids.creator) });
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toEqual({
      rev: 1,
      buildId: ids.build,
      doc: { schemaVersion: 1, globals: { gravity: 2 }, entities: {} },
    });
  });

  it("serves a build's own design, not the edited branch head, so a review link plays what was reviewed", async () => {
    const { app } = await setup();
    const lease = await acquire(app, 'browser-one');
    await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(transaction(0, lease.body.token, 'browser-one', 2)),
    });
    const build = await app.request(`/api/v1/games/${ids.game}/builds/${ids.build}/design`, {
      headers: asUser(ids.creator),
    });
    expect(await build.json()).toEqual({
      rev: 0,
      buildId: ids.build,
      doc: { schemaVersion: 1, globals: { gravity: 1 }, entities: {} },
    });
    const missing = await app.request(`/api/v1/games/${ids.game}/builds/build_01K8Z6Y7X8P9Q0R1S2T3V4W5XB/design`, {
      headers: asUser(ids.creator),
    });
    expect(missing.status).toBe(404);
  });

  it('serializes 50 competing writers into revisions 1 through 50', async () => {
    const { app } = await setup();
    const lease = await acquire(app, 'browser-one');

    async function append(gravity: number): Promise<number> {
      let baseRev = 0;
      for (;;) {
        const response = await app.request(`${branchUrl}/transactions`, {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify(transaction(baseRev, lease.body.token, 'browser-one', gravity)),
        });
        const body = (await response.json()) as { rev?: number; headRev?: number };
        if (response.status === 200) return body.rev!;
        expect(response.status).toBe(409);
        baseRev = body.headRev!;
      }
    }

    const revisions = await Promise.all(Array.from({ length: 50 }, (_, index) => append(index + 2)));
    expect([...revisions].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
  }, 20_000);

  it('accepts a token-zero system transaction from an internal service without a lease', async () => {
    const { app } = await setup();
    const response = await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${INTERNAL_TOKEN}`,
        'content-type': 'application/json',
        'x-ogm-service': 'builder',
      },
      body: JSON.stringify({
        ...transaction(0, 0, 'unused', 2),
        actor: 'u_01K8Z6Y7X8P9Q0R1S2T3V4W5XB',
        kind: 'system',
        sessionId: undefined,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rev: 1 });
  });

  it('replays transactions after Last-Event-ID in order and then streams live commits', async () => {
    const { app } = await setup();
    const lease = await acquire(app, 'browser-one');
    for (let rev = 0; rev < 3; rev += 1) {
      const response = await app.request(`${branchUrl}/transactions`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(transaction(rev, lease.body.token, 'browser-one', rev + 2)),
      });
      expect(response.status).toBe(200);
    }

    const response = await app.request(`${branchUrl}/transactions?after=0`, {
      headers: { ...asUser(ids.creator), 'last-event-id': '1' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const replay = await readUntil(reader, (text) => text.includes('id: 3\n'));
    expect(replay).not.toContain('id: 1\n');
    expect(replay.indexOf('id: 2\n')).toBeLessThan(replay.indexOf('id: 3\n'));

    const live = await app.request(`${branchUrl}/transactions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(transaction(3, lease.body.token, 'browser-one', 5)),
    });
    expect(live.status).toBe(200);
    const liveFrame = await readUntil(reader, (text) => text.includes('id: 4\n'));
    expect(liveFrame).toContain('event: tx\n');
    await reader.cancel();
  });
});
