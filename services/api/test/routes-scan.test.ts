import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app/app.js';
import { scanRoutes } from '../src/app/routes-scan.js';
import { makeApp, makeDeps } from './helpers.js';

// Temp contexts live inside the package so their `import 'hono'` resolves like a real context.
const roots: string[] = [];
function tempRoot(contexts: Record<string, Record<string, string>>): URL {
  const root = mkdtempSync(join(import.meta.dirname, '.scan-'));
  roots.push(root);
  for (const [context, files] of Object.entries(contexts)) {
    mkdirSync(join(root, context), { recursive: true });
    for (const [name, source] of Object.entries(files)) writeFileSync(join(root, context, name), source);
  }
  return pathToFileURL(`${root}/`);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ping = `import { Hono } from 'hono';\nexport default new Hono().get('/ping', (c) => c.text('pong'));\n`;

async function scan(root: URL) {
  const deps = makeDeps();
  const app = createApp(deps);
  return { app, deps, ...(await scanRoutes(app, { deps, root })) };
}

describe('scanRoutes', () => {
  it('mounts a context by its directory name under /api/v1', async () => {
    const { app, mounted } = await scan(tempRoot({ 'zz-test': { 'routes.ts': ping } }));
    expect(mounted).toEqual([{ prefix: '/api/v1/zz-test', file: 'zz-test/routes.ts' }]);
    const response = await app.request('/api/v1/zz-test/ping');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('pong');
  });

  it('ignores contexts without routes.ts, stray files and the app directory', async () => {
    const { mounted } = await scan(
      tempRoot({
        empty: { 'service.ts': ping },
        app: { 'routes.ts': ping },
        Bad_Name: { 'routes.ts': ping },
      }),
    );
    expect(mounted).toEqual([]);
  });

  it('honours an exported prefix and runs setup with the deps first', async () => {
    const source = `import { Hono } from 'hono';
export const prefix = '/internal/x';
let seen = 'no';
export function setup(deps) { seen = deps.version; }
export default new Hono().get('/seen', (c) => c.text(seen));
`;
    const { app } = await scan(tempRoot({ x: { 'routes.ts': source } }));
    expect(await (await app.request('/internal/x/seen')).text()).toBe('test-version');
    expect((await app.request('/api/v1/x/seen')).status).toBe(404);
  });

  it('fails boot naming the file when the default export is not a Hono app', async () => {
    const root = tempRoot({ broken: { 'routes.ts': 'export default { fetch() {} };\n' } });
    await expect(scan(root)).rejects.toThrow(/broken\/routes\.ts: default export must be a Hono app/);
  });

  it('lets directory-scanned contexts share a prefix when their routes are distinct', async () => {
    const a = `import { Hono } from 'hono';\nexport const prefix = '/same';\nexport default new Hono().get('/a', c => c.text('a'));\n`;
    const b = `import { Hono } from 'hono';\nexport const prefix = '/same';\nexport default new Hono().get('/b', c => c.text('b'));\n`;
    const { app, mounted } = await scan(tempRoot({ a: { 'routes.ts': a }, b: { 'routes.ts': b } }));
    expect(mounted.map(({ prefix }) => prefix)).toEqual(['/same', '/same']);
    expect(await (await app.request('/same/a')).text()).toBe('a');
    expect(await (await app.request('/same/b')).text()).toBe('b');
  });

  it('fails boot when shared-prefix contexts register the same method and path', async () => {
    const route = `import { Hono } from 'hono';\nexport const prefix = '/same';\nexport default new Hono().get('/ping', c => c.text('pong'));\n`;
    const root = tempRoot({ a: { 'routes.ts': route }, b: { 'routes.ts': route } });
    await expect(scan(root)).rejects.toThrow(
      /b\/routes\.ts: route GET \/same\/ping is already mounted by a\/routes\.ts/,
    );
  });

  it('lets shared-prefix contexts use different methods on the same path', async () => {
    const get = `import { Hono } from 'hono';\nexport const prefix = '/same';\nexport default new Hono().get('/ping', c => c.text('get'));\n`;
    const post = `import { Hono } from 'hono';\nexport const prefix = '/same';\nexport default new Hono().post('/ping', c => c.text('post'));\n`;
    const { app } = await scan(tempRoot({ a: { 'routes.ts': get }, b: { 'routes.ts': post } }));
    expect(await (await app.request('/same/ping')).text()).toBe('get');
    expect(await (await app.request('/same/ping', { method: 'POST' })).text()).toBe('post');
  });

  it('mounts the shipped contexts', async () => {
    const { mounted } = await makeApp();
    expect(mounted.map(({ prefix }) => prefix)).toEqual([
      '/api/v1',
      '/api/v1',
      '/api/v1/admin',
      '/api/v1/analytics',
      '/auth',
      '/blobs',
      '/api/v1',
      '/api/v1/budget',
      '/api/v1/jobs',
      '/internal',
      '/api/catalog',
      '/api/v1',
      '/internal',
      '/api/v1',
      '/api/v1',
      '/api/v1',
      '/',
      '/api/v1/energy',
      '/api/v1',
      '/api/v1/admin/gameplay',
      '/api/v1',
      '/api/v1',
      '/',
      '/internal',
      '/api/v1',
      '/api/v1/jobs',
      '/api/v1',
      '/api/v1/games',
      '/internal/new-game',
      '/',
      '/internal/operator',
      '/api/v1',
      '/',
      '/api/v1/reports',
      '/api/v1',
      '/',
      '/api/v1',
      '/api/v1',
      '/api/v1/games',
      '/api/v1/admin/users',
      '/',
      '/api/v1',
    ]);
  });
});
