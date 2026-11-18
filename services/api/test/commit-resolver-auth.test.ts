import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { RepoResolver } from '../../commit/src/repo-resolver.js';
import { principalMiddleware, requirePrincipal } from '../src/app/principal.js';
import type { ApiBindings } from '../src/app/types.js';
import { INTERNAL_TOKEN, makeDeps } from './helpers.js';

describe('commit repository lookup authentication', () => {
  it('authenticates the resolver as the commit service through the real middleware', async () => {
    const app = new Hono<ApiBindings>();
    app.use('*', async (c, next) => {
      c.set('deps', makeDeps());
      await next();
    });
    app.use('*', principalMiddleware());
    app.get('/internal/games/:id/repo', (c) => {
      expect(requirePrincipal(c, ['service'])).toEqual({ kind: 'service', service: 'commit' });
      return c.json({ owner: 'owner', name: 'instance', path: 'games/example', slug: 'example', visibility: 'private' });
    });
    const fetchApp: typeof fetch = (input, init) => app.request(input instanceof Request ? input : String(input), init);
    const resolver = new RepoResolver('http://localhost', INTERNAL_TOKEN, fetchApp);
    await expect(resolver.resolve('game-1')).resolves.toMatchObject({ path: 'games/example' });
  });
});
