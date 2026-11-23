import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { frameFailures, observeFrame } from '../src/qa-frame-check.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launchWebkit']>>;

/*
 * 2026-11-23: an app domain the games host's frame-ancestors did not list showed Try again in every game (#1297).
 * A games host that allows one app origin, that app, a second domain serving the same app, and an alias that 301s to
 * the allowed one. CI installs only Chromium, which refuses the frame the same way; WebKit runs where it is installed.
 */
function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  return new Promise((done) => {
    const server = createServer(handler).listen(0, '127.0.0.1', () => done(server));
  });
}
const origin = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let app: Server, other: Server, alias: Server, games: Server;
beforeAll(async () => {
  const page = (_: unknown, res: import('node:http').ServerResponse) => res.end('<!doctype html><p>app</p>');
  app = await listen(page);
  other = await listen(page);
  alias = await listen((_, res) => res.writeHead(301, { Location: `${origin(app)}/` }).end());
  games = await listen((_, res) => {
    res.setHeader('Content-Security-Policy', `frame-ancestors ${origin(app)}`);
    res.end('<!doctype html><canvas></canvas>');
  });
});
afterAll(() => Promise.all([app, other, alias, games].map((server) => new Promise((done) => server.close(done)))));

// WebKit runs where it is installed; Playwright's launch fails before starting anything when it is not.
async function launchWebkitIfInstalled(): Promise<Browser | null> {
  const verify = await import('@ogm/gm-verify');
  return verify.launchWebkit().catch((error: Error) => {
    if (/Executable doesn't exist/u.test(error.message)) return null;
    throw error;
  });
}

describe('qa frame-check', () => {
  it('passes the allowed app and an alias that redirects to it, and fails a domain the games host does not list', async () => {
    const verify = await import('@ogm/gm-verify');
    const browsers: [string, Browser | null][] = [
      ['chromium', await verify.launch(true)],
      ['webkit', await launchWebkitIfInstalled()],
    ];
    for (const [name, browser] of browsers) {
      if (!browser) continue;
      try {
        const frame = `${origin(games)}/g/game/build/`;
        const allowed = await observeFrame(browser, origin(app), frame, 10_000);
        expect([name, frameFailures(allowed)]).toEqual([name, []]);

        const redirected = await observeFrame(browser, origin(alias), frame, 10_000);
        expect([name, redirected.landed, frameFailures(redirected)]).toEqual([name, origin(app), []]);

        const refused = await observeFrame(browser, origin(other), frame, 10_000);
        expect([name, refused.landed]).toEqual([name, origin(other)]);
        expect(frameFailures(refused)).toContain('the game frame stayed empty');
        expect(refused.refusals.join(' ')).toMatch(/frame-ancestors/u);
      } finally {
        await browser.close();
      }
    }
  });
});
