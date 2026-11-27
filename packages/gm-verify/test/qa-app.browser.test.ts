import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import { launch, routeGameToLocal } from '../src/browser.js';
import { driveJourney } from '../src/qa/drive.js';
import { soloJourneySchema } from '../src/qa/journey.js';

it('requires a real session before driving the app and routes the build into its frame', async () => {
  const app = createServer((req, res) => {
    if (req.url === '/api/v1/me') {
      res.writeHead(req.headers.cookie === 'session=valid' ? 200 : 401, { 'content-type': 'application/json' });
      res.end(req.headers.cookie === 'session=valid' ? '{"user":{"id":"qa"}}' : '{}');
    } else {
      res.end(
        '<iframe src="http://localhost:39999/g/game/build/index.html"></iframe><div style="position:absolute;left:12px;top:12px;background:red;width:50px;height:50px;pointer-events:none">overlay</div>',
      );
    }
  });
  let missing = false;
  let blank = false;
  const game = createServer((req, res) => {
    if (missing) {
      res.writeHead(404).end();
      return;
    }
    if (blank) {
      res.setHeader('content-type', 'text/html');
      res.end('<body></body>');
      return;
    }
    if (req.url === '/game.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end('document.addEventListener("pointerdown",()=>console.warn("local build tapped"))');
    } else {
      res.setHeader('content-type', 'text/html');
      res.end('<body><button id="play">local build</button><script src="/game.js"></script></body>');
    }
  });
  await Promise.all([
    new Promise<void>((r) => app.listen(0, '127.0.0.1', r)),
    new Promise<void>((r) => game.listen(0, '127.0.0.1', r)),
  ]);
  const appUrl = `http://127.0.0.1:${(app.address() as { port: number }).port}/play/game`;
  const gameUrl = `http://127.0.0.1:${(game.address() as { port: number }).port}/`;
  const dir = mkdtempSync(join(tmpdir(), 'qa-app-'));
  const storage = join(dir, 'storage.json');
  const journey = soloJourneySchema.parse({
    name: 'app',
    viewport: 'phone',
    steps: [
      { do: 'expect', text: 'local build' },
      { do: 'tap', selector: '#play' },
      { do: 'shot', name: 'played' },
    ],
  });
  const browser = await launch(process.env.GM_VERIFY_SOFTWARE_GL === '1');
  try {
    writeFileSync(storage, JSON.stringify({ cookies: [], origins: [] }));
    const denied = await driveJourney(browser, gameUrl, journey, {
      outDir: dir,
      app: { url: appUrl, storageState: storage },
      ffmpegBinary: 'missing-ffmpeg',
    });
    expect(denied.verdict).toBe('fail');
    expect(denied.steps[0]?.error).toContain('not signed in');
    writeFileSync(
      storage,
      JSON.stringify({
        cookies: [
          {
            name: 'session',
            value: 'valid',
            domain: '127.0.0.1',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      }),
    );
    const allowed = await driveJourney(browser, gameUrl, journey, {
      outDir: dir,
      app: { url: appUrl, storageState: storage },
      ffmpegBinary: 'missing-ffmpeg',
    });
    expect(allowed.verdict).toBe('pass');
    expect(allowed.console.some((entry) => entry.text === 'local build tapped')).toBe(true);
    expect(existsSync(join(dir, 'app', allowed.steps[2]!.shot!))).toBe(true);
    missing = true;
    const notFound = await driveJourney(browser, gameUrl, journey, {
      outDir: dir,
      app: { url: appUrl, storageState: storage },
      ffmpegBinary: 'missing-ffmpeg',
      readyTimeoutMs: 1_000,
    });
    expect(notFound.verdict).toBe('fail');
    expect(notFound.steps[0]?.error).toMatch(/HTTP 404|mounted no game frame/);
    missing = false;
    blank = true;
    const blankFrame = await driveJourney(browser, gameUrl, journey, {
      outDir: dir,
      app: { url: appUrl, storageState: storage },
      ffmpegBinary: 'missing-ffmpeg',
      readyTimeoutMs: 500,
    });
    expect(blankFrame.verdict).toBe('fail');
    expect(blankFrame.steps[0]?.error).toContain('non-blank pixels');
  } finally {
    await browser.close();
    await Promise.all([
      new Promise<void>((r) => app.close(() => r())),
      new Promise<void>((r) => game.close(() => r())),
    ]);
  }
});

it('does not proxy a game path to another local service', async () => {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.end('secret');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const browser = await launch(process.env.GM_VERIFY_SOFTWARE_GL === '1');
  const context = await browser.newContext();
  try {
    await routeGameToLocal(context, { url: 'http://app.example/play/game', localUrl: 'http://127.0.0.1:1/' });
    const page = await context.newPage();
    const response = await page.goto(`http://games.example/g/a/b///127.0.0.1:${port}/secret`);
    expect(response?.status()).toBe(403);
    expect(hits).toBe(0);
  } finally {
    await context.close();
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
