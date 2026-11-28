import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

import { createApp } from '../src/server.js';

it('authorizes a live generation and pins its assets while the current build changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'live-route-'));
  try {
    const workspace = join(root, 'workspace');
    const live = join(workspace, '.gm/live');
    const first = '11111111-1111-1111-1111-111111111111';
    const second = '22222222-2222-2222-2222-222222222222';
    for (const [id, text] of [
      [first, 'first'],
      [second, 'second'],
    ]) {
      const directory = join(live, 'versions', id!);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'index.html'), text!);
      await writeFile(join(directory, 'game.js'), text!);
    }
    await symlink(`versions/${first}`, join(live, 'current'));
    const accessId = 'lv-33333333-3333-3333-3333-333333333333';
    const grants = join(root, '.live', 'demo');
    await mkdir(grants, { recursive: true });
    const grantPath = join(root, 'repo', 'grants', 'grant.json');
    const grantId = '55555555-5555-5555-5555-555555555555';
    await mkdir(join(root, 'repo', 'grants'), { recursive: true });
    const grant = JSON.stringify({ grant: grantId });
    await writeFile(grantPath, grant);
    await writeFile(join(root, 'repo', 'secret'), 'secret');
    const grantHash = createHash('sha256').update(grant).digest('hex');
    const secretHash = createHash('sha256').update('secret').digest('hex');
    const digest = createHash('sha256').update('first').digest('hex');
    await writeFile(
      join(grants, `${accessId}.json`),
      JSON.stringify({
        gameId: 'demo',
        accessId,
        root: live,
        version: first,
        grantPath,
        grantId,
        grantHash,
        secretHash,
        manifest: { 'index.html': digest, 'game.js': digest },
        expiresAt: '2999-01-01',
      }),
    );
    const alias = 'pv-66666666-6666-6666-6666-666666666666';
    let authorized = true;
    const app = createApp({
      root,
      appOrigin: 'https://app.example.test',
      version: 'test',
      workerScript: '',
      resolvePreview: async (game, token) => (authorized && game === 'demo' && token === alias ? accessId : null),
    });
    const response = await app.request(`/l/demo/${alias}/?scenario=yard`);
    expect(response.status).toBe(302);
    const url = response.headers.get('location')!;
    expect(url).toBe(`/l/demo/${alias}/${first}/index.html?scenario=yard`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await (await app.request(url)).text()).toContain('first');
    await unlink(join(live, 'current'));
    await symlink(`versions/${second}`, join(live, 'current'));
    expect(await (await app.request(`/l/demo/${alias}/${first}/game.js`)).text()).toBe('first');
    const range = await app.request(`/l/demo/${alias}/${first}/game.js`, { headers: { Range: 'bytes=1-3' } });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe('irs');
    expect((await app.request(`/l/demo/${alias}/`)).headers.get('location')).toContain(first);
    expect((await app.request(`/l/demo/${alias}/${second}/game.js`)).status).toBe(404);
    await writeFile(join(live, 'versions', first, 'game.js'), 'changed');
    expect((await app.request(`/l/demo/${alias}/${first}/game.js`)).status).toBe(404);
    authorized = false;
    expect((await app.request(`/l/demo/${alias}/${first}/index.html`)).status).toBe(404);
    authorized = true;
    await unlink(grantPath);
    expect((await app.request(`/l/demo/${alias}/`)).status).toBe(404);
    expect((await app.request(`/l/demo/lv-44444444-4444-4444-4444-444444444444/`)).status).toBe(404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
