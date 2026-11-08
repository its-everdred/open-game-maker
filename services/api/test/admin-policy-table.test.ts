import { describe, expect, it } from 'vitest';

import { seededApp, X, Y } from './admin-fixture.js';
import type { TestUser } from './helpers.js';

// Every admin route against the four actors. A family admin acts only on their own family, so
// family Y's admin gets 200 with only Y's data on list routes and 404 on X's ids, never X's rows.
type Actor = 'owner' | 'admin' | 'member' | 'otherAdmin';
const ACTORS: Record<Actor, TestUser> = { owner: X.owner, admin: X.admin, member: X.player, otherAdmin: Y.admin };
type Row = { method: string; path: string; body?: unknown; expect: Record<Actor, number> };

const ok = (status: number, other = 200) => ({ owner: status, admin: status, member: 403, otherAdmin: other });
const ROUTES: Row[] = [
  { method: 'GET', path: '/members', expect: ok(200) },
  { method: 'PATCH', path: `/members/${X.player.userId}`, body: { capability: 'creator' }, expect: ok(200, 404) },
  { method: 'DELETE', path: `/members/${X.player.userId}`, expect: ok(204, 404) },
  {
    method: 'PATCH',
    path: `/members/${X.owner.userId}`,
    body: { role: 'member' },
    expect: { owner: 409, admin: 409, member: 403, otherAdmin: 404 },
  },
  {
    method: 'DELETE',
    path: `/members/${X.owner.userId}`,
    expect: { owner: 409, admin: 409, member: 403, otherAdmin: 404 },
  },
  {
    method: 'PATCH',
    path: `/members/${X.admin2.userId}`,
    body: { role: 'member' },
    expect: { owner: 200, admin: 403, member: 403, otherAdmin: 404 },
  },
  {
    method: 'DELETE',
    path: `/members/${X.admin2.userId}`,
    expect: { owner: 204, admin: 403, member: 403, otherAdmin: 404 },
  },
  { method: 'GET', path: '/invites', expect: ok(200) },
  { method: 'DELETE', path: `/invites/${X.invite}`, expect: ok(204, 404) },
  { method: 'GET', path: '/settings', expect: ok(200) },
  { method: 'PATCH', path: '/settings', body: { unitLabel: 'stars' }, expect: ok(200) },
  { method: 'GET', path: '/allowances', expect: ok(200) },
  { method: 'PUT', path: `/allowances/${X.player.userId}`, body: { dailyMicroUsd: 1_000 }, expect: ok(200, 404) },
  { method: 'GET', path: '/budget', expect: ok(200) },
  { method: 'GET', path: '/games?includeDelisted=1', expect: ok(200) },
  {
    method: 'POST',
    path: '/games/import',
    body: {
      title: 'Registered Game',
      repo: { owner: 'open-games', name: 'games', path: 'games/registered-game' },
      daemon: {
        port: 4021,
        checkoutPath: '/srv/open-games',
        unit: 'ogm-aiur@open-games.service',
        envFile: '/srv/config/ogm-aiur@open-games.env',
      },
    },
    expect: ok(201, 201),
  },
  { method: 'POST', path: `/games/${X.game}/delist`, expect: ok(200, 404) },
  { method: 'POST', path: `/games/${X.game}/relist`, expect: ok(200, 404) },
  {
    method: 'POST',
    path: `/games/${X.game}/flag-abuse`,
    body: { reason: 'spam' },
    expect: ok(201, 404),
  },
  { method: 'GET', path: '/builds', expect: ok(200) },
  { method: 'GET', path: '/gameplay', expect: ok(200) },
  { method: 'PATCH', path: '/gameplay', body: { paidApisDuringGameplay: false }, expect: ok(200) },
  { method: 'GET', path: '/intake', expect: ok(200) },
  { method: 'GET', path: '/mail?unopened=1', expect: ok(200) },
  { method: 'POST', path: `/mail/${X.mail}/opened`, expect: ok(204, 404) },
  { method: 'GET', path: '/users', expect: ok(200) },
  {
    method: 'POST',
    path: '/users',
    body: { email: 'guest@example.com', role: 'player' },
    expect: ok(201, 201),
  },
  {
    method: 'PATCH',
    path: '/users/guest@example.com',
    body: { role: 'maker' },
    expect: ok(404, 404),
  },
  { method: 'DELETE', path: '/users/guest@example.com', expect: ok(404, 404) },
  {
    method: 'POST',
    path: '/users/guest@example.com/invite',
    body: {},
    expect: ok(404, 404),
  },
];

const PARAM: Record<string, string> = { u: ':userId', g: ':id', i: ':id', m: ':id' };

const X_IDS = [
  X.family,
  X.game,
  X.invite,
  X.mail,
  'friend@example.com',
  ...[X.owner, X.admin, X.admin2, X.creator, X.player].map((u) => u.userId),
];

const rows = ROUTES.flatMap((route) =>
  (Object.keys(ACTORS) as Actor[]).map((actor) => ({ ...route, actor, status: route.expect[actor] })),
);

describe('admin policy table', () => {
  it('covers every mounted admin route', async () => {
    const { app } = await seededApp();
    const mounted = app.routes
      .filter((route) => route.path.startsWith('/api/v1/admin/'))
      .map((route) => `${route.method} ${route.path.replace('/api/v1/admin', '')}`);
    const template = (path: string) =>
      path
        .split('?')[0]
        .replace(/\/users\/[^/]+/, '/users/:email')
        .replace(/\/(u|g|i|m)-[a-z0-9]+/g, (_, kind: string) => `/${PARAM[kind]}`);
    expect(new Set(ROUTES.map((row) => `${row.method} ${template(row.path)}`))).toEqual(new Set(mounted));
  });

  it.each(rows)('$method $path as $actor -> $status', async ({ method, path, body, actor, status }) => {
    const { call } = await seededApp();
    const response = await call(ACTORS[actor], method, path, body);
    expect(response.status).toBe(status);
    // A 404 must come from an admin route refusing X's id, not from a missing route.
    if (status === 404)
      expect(((await response.clone().json()) as { error: string }).error).toMatch(/^[a-z]+_not_found$/);
    if (actor === 'otherAdmin' && status < 300) {
      const text = await response.text();
      for (const id of X_IDS) expect(text).not.toContain(id);
    }
  });
});
