import { serve, type ServerType } from '@hono/node-server';
import { expect, test } from '@playwright/test';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { markComplete } from '../../src/layout.js';
import { createApp } from '../../src/server.js';

test('one game cannot read another protected game using the player’s existing access', async ({ page, context }) => {
  const root = await mkdtemp(join(tmpdir(), 'ogm-isolation-'));
  let server: ServerType | undefined;
  try {
    for (const game of ['attacker', 'victim']) {
      const build = join(root, game, 'build1');
      await mkdir(build, { recursive: true });
      await writeFile(
        join(build, 'index.html'),
        `<html><body>${game}<script type="module" src="/g/${game}/build1/main.js"></script></body></html>`,
      );
      await writeFile(
        join(build, 'main.js'),
        `document.body.dataset.loaded = (await fetch('/g/${game}/build1/data.json').then((r) => r.json())).ok;`,
      );
      await writeFile(join(build, 'data.json'), '{"ok":"yes"}');
      await markComplete(build);
    }
    const app = createApp({
      root,
      accessCheck: async (game, token) => game === 'attacker' || (game === 'victim' && token === 'gba1.victim.token'),
      appOrigin: 'http://127.0.0.1:3000',
      version: 'test',
      workerScript: join(root, 'missing-worker.js'),
    });
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind a TCP port');
    const origin = `http://127.0.0.1:${address.port}`;
    await context.addCookies([{ name: 'ogm_build_victim', value: 'victim-token', url: origin, httpOnly: true }]);
    await page.goto(`${origin}/g/attacker/build1/index.html`);
    const status = await page.evaluate(async () => (await fetch('/g/victim/build1/index.html')).status);
    expect(status).toBe(403);

    // The victim's own launch: an opaque document whose absolute asset paths keep its capability.
    await page.goto(`${origin}/t/gba1.victim.token/g/victim/build1/index.html`);
    await expect(page.locator('body')).toHaveAttribute('data-loaded', 'yes');
    expect(await page.evaluate(() => self.origin)).toBe('null');
  } finally {
    if (server) {
      server.close();
      await once(server, 'close');
    }
    await rm(root, { recursive: true, force: true });
  }
});
