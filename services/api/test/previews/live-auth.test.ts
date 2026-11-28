import { expect, it, vi } from 'vitest';
import { createApp } from '../../src/app/app.js';
import { bindPreview, validPreview } from '../../src/artifacts/grants.js';
import previewRoutes from '../../src/previews/routes.js';
import { postRound } from '../../src/review-rounds/store.js';
import { ids, world } from '../builds/fixtures.js';

vi.mock('../../src/previews/live.js', () => ({
  issueLiveAccess: async () => ({ accessId: 'lv-11111111-1111-1111-1111-111111111111', version: 'v', design: {} }),
}));

it('returns a session-bound alias and forbids caching the live capability', async () => {
  const { deps } = world();
  let signedIn = true;
  deps.registry.principalResolvers = [
    async (c) =>
      signedIn && c.req.header('cookie') === 'session=owner'
        ? {
            kind: 'user',
            userId: ids.user,
            familyId: ids.family,
            displayName: 'Owner',
            platformRole: 'none',
            capability: 'creator',
          }
        : null,
  ];
  const app = createApp(deps);
  app.route('/api/v1', previewRoutes);
  const response = await app.request(`http://example.test/api/v1/games/${ids.game}/live/12`, {
    headers: { cookie: 'session=owner' },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = (await response.json()) as { accessId: string };
  expect(body.accessId).toMatch(/^pv-/u);
  expect(body.accessId).not.toBe('lv-11111111-1111-1111-1111-111111111111');
  expect(await validPreview(deps, ids.game, body.accessId)).toBe('lv-11111111-1111-1111-1111-111111111111');
  signedIn = false;
  expect(await validPreview(deps, ids.game, body.accessId)).toBeNull();
});

it('revokes a cross-game administrator preview when the administrator is demoted', async () => {
  const { deps } = world();
  let admin = true;
  deps.registry.principalResolvers = [
    async () => ({
      kind: 'user',
      userId: 'admin-user',
      familyId: 'other-family',
      platformRole: admin ? 'admin' : 'none',
      capability: 'creator',
    }),
  ];
  const alias = bindPreview(deps, ids.game, 'preview-source', 'admin-user', new Headers());
  expect(await validPreview(deps, ids.game, alias)).toBe('preview-source');
  admin = false;
  expect(await validPreview(deps, ids.game, alias)).toBeNull();
});

it('allows only an administrator to resolve and open another game’s active live review', async () => {
  const { deps } = world();
  let admin = true;
  deps.registry.principalResolvers = [
    async () => ({
      kind: 'user',
      userId: 'other',
      familyId: 'other-family',
      platformRole: admin ? 'admin' : 'none',
      capability: 'creator',
    }),
  ];
  postRound(deps.db, {
    id: 'round',
    gameId: ids.game,
    track: 'game',
    phase: 'build',
    category: 'gameplay',
    round: 1,
    ticket: '12',
    sha: 'a'.repeat(40),
    media: JSON.stringify([{ kind: 'build', ref: 'live-round' }]),
    postedAt: '2026-11-28T00:00:00Z',
  });
  const app = createApp(deps);
  app.route('/api/v1', previewRoutes);
  const resolve = () => app.request(`/api/v1/games/live-resolve/${ids.game}/12`);
  const open = () => app.request(`/api/v1/games/${ids.game}/live/12`);
  expect((await resolve()).status).toBe(200);
  const response = await open();
  expect(response.status).toBe(200);
  const { accessId } = (await response.json()) as { accessId: string };
  expect(await validPreview(deps, ids.game, accessId)).toBe('lv-11111111-1111-1111-1111-111111111111');
  admin = false;
  expect((await resolve()).status).toBe(404);
  expect((await open()).status).not.toBe(200);
  expect(await validPreview(deps, ids.game, accessId)).toBeNull();
});
