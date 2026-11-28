import { expect, it, vi } from 'vitest';
import { createApp } from '../../src/app/app.js';
import { validPreview } from '../../src/artifacts/grants.js';
import previewRoutes from '../../src/previews/routes.js';
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
