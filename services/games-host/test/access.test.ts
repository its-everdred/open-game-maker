import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/server.js';
import { markComplete } from '../src/layout.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('fails closed when no authorization service is configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ogm-access-'));
  dirs.push(root);
  const build = join(root, 'game', 'b1');
  await mkdir(build, { recursive: true });
  await writeFile(join(build, 'index.html'), 'game');
  await markComplete(build);
  const app = createApp({ root, appOrigin: 'https://app.test', version: 'test', workerScript: join(root, 'sw') });
  expect((await app.request('/g/game/b1/index.html')).status).toBe(403);
});

it('refuses unsigned builds and shared build assets, then checks the path capability on each request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ogm-access-'));
  dirs.push(root);
  const build = join(root, 'game', 'b1');
  await mkdir(join(build, 'assets'), { recursive: true });
  const hash = 'a'.repeat(64);
  const file = `${hash}.glb`;
  await mkdir(join(root, '_a'));
  await writeFile(join(root, '_a', file), 'asset');
  await writeFile(join(build, 'index.html'), `<img src="/a/${file}"><script src="/g/game/b1/x.js"></script>`);
  await writeFile(
    join(build, 'assets', 'cache-plan.json'),
    JSON.stringify({
      version: 1,
      gameId: 'game',
      buildId: 'b1',
      built: '2026-11-01T00:00:00.000Z',
      sdkVersion: '1',
      tiers: ['desktop'],
      entries: [
        {
          sourcePath: 'asset.glb',
          url: `/a/${file}`,
          sha256: hash,
          bytes: 5,
          kind: 'model',
          phase: 'boot',
          tiers: ['*'],
        },
      ],
      totals: {
        desktop: { boot: { bytes: 5, files: 1 }, ready: { bytes: 0, files: 0 }, stream: { bytes: 0, files: 0 } },
        mobile: { boot: { bytes: 0, files: 0 }, ready: { bytes: 0, files: 0 }, stream: { bytes: 0, files: 0 } },
        low: { boot: { bytes: 0, files: 0 }, ready: { bytes: 0, files: 0 }, stream: { bytes: 0, files: 0 } },
      },
    }),
  );
  await markComplete(build);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { token?: string };
      return new Response(null, { status: body.token === 'gba1.YQ.Yg' ? 204 : 403 });
    }),
  );
  const app = createApp({
    root,
    appOrigin: 'https://app.test',
    version: 'test',
    workerScript: join(root, 'sw'),
    accessApi: 'http://127.0.0.1:3000',
  });
  const token = '/t/gba1.YQ.Yg';
  const cookie = { cookie: 'ogm_build_game=gba1.YQ.Yg' };
  expect((await app.request('/g/game/b1/index.html')).status).toBe(403);
  expect((await app.request(`/a/${file}`)).status).toBe(403);
  // A cookie is never a capability: another game in the same browser could send it.
  expect((await app.request('/g/game/b1/index.html', { headers: cookie })).status).toBe(403);
  expect((await app.request(`/a/${file}`, { headers: cookie })).status).toBe(403);
  expect((await app.request(`/t/gba1.YQ.Yh/g/game/b1/index.html`)).status).toBe(403);
  const response = await app.request(`${token}/g/game/b1/index.html?frameObserver=2`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts allow-pointer-lock');
  const html = await response.text();
  expect(html).toContain(`<script src="./__ogm_preview_bootstrap.js"></script>`);
  // Built bundles use absolute paths; each must keep the capability or the opaque frame's own assets would 403.
  expect(html).toContain(`<img src="${token}/a/${file}"><script src="${token}/g/game/b1/x.js"></script>`);
  expect((await app.request(`${token}/a/${file}`)).status).toBe(200);
  await writeFile(
    join(build, 'assets', 'cache-plan.json'),
    JSON.stringify({
      version: 1,
      gameId: 'game',
      buildId: 'b1',
      built: '2026-11-01T00:00:00.000Z',
      sdkVersion: '1',
      tiers: ['desktop'],
      entries: [],
      totals: {
        desktop: { boot: { bytes: 0, files: 0 }, ready: { bytes: 0, files: 0 }, stream: { bytes: 0, files: 0 } },
        mobile: { boot: { bytes: 0, files: 0 }, ready: { bytes: 0, files: 0 }, stream: { bytes: 0, files: 0 } },
        low: { boot: { bytes: 0, files: 0 }, ready: { bytes: 0, files: 0 }, stream: { bytes: 0, files: 0 } },
      },
    }),
  );
  expect((await app.request(`${token}/a/${file}`)).status).toBe(403);
});
