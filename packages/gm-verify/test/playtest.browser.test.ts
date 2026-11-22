import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

import type { PlaytestRun } from '../src/qa/playtest.js';
import { serveStatic } from '../src/server.js';

const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('../../../apps/web/e2e/fixtures/bridge-game/', import.meta.url));
const runner = fileURLToPath(new URL('../dist/app-capture/playtest.js', import.meta.url));

/*
 * A two-mode fixture: "Good" draws one board under a clean HUD; "Bad" draws what Kevin met in Blobs' Both mode
 * (#866): a second board, a SCORE plate over the board, selectable HUD text, a colourless piece and a console error.
 */
const modes = `
const root = document.getElementById('canvas');
let state = { pieces: [{ colour: '#f00' }] };
window.__gmQa = {
  invariants: () => [
    { name: 'exactly one board', ok: document.querySelectorAll('[data-gm-play-area]').length === 1 },
    { name: 'every piece has a colour', ok: state.pieces.every((piece) => piece.colour) },
  ],
};
const board = () => '<div data-gm-play-area style="position:absolute;left:10%;top:20%;width:80%;height:60%;background:#333"></div>';
root.innerHTML = '<button id="good">Good</button><button id="bad">Bad</button>';
document.getElementById('good').onclick = () => {
  root.innerHTML = board() + '<div style="position:absolute;top:0;left:0">SCORE</div>';
};
document.getElementById('bad').onclick = () => {
  document.documentElement.classList.add('bad');
  state = { pieces: [{ colour: '#f00' }, { colour: '' }] };
  root.innerHTML = board() + board() + '<div style="position:absolute;top:30%;left:20%">SCORE</div>';
  console.error('board drawn twice');
};
`;

/*
 * The games host's view of a build published with a cache plan (#1250): index.html without `frameObserver` redirects
 * away from the observer, and the build's scripts live at the origin's `/a/`, never under the build path.
 */
async function cachePlanHost(game: string): Promise<{ url: string; close(): Promise<void> }> {
  const files = await serveStatic(game);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (/^\/g\/[^/]+\/[^/]+\/(index\.html)?$/u.test(url.pathname) && !url.searchParams.has('frameObserver')) {
      res.writeHead(308, { location: '/a/unobserved.html' }).end();
      return;
    }
    if (/^\/g\/[^/]+\/[^/]+\/a\//u.test(url.pathname)) {
      res.writeHead(404).end();
      return;
    }
    void fetch(new URL(url.pathname, files.url)).then(async (upstream) => {
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? '' });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/g/game/build_1/`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await files.close();
    },
  };
}

async function playFixture(via: 'dist' | 'url' | 'cache-plan') {
  expect(existsSync(runner)).toBe(true);
  const root = mkdtempSync(join(tmpdir(), 'gm-playtest-test-'));
  const game = join(root, 'game');
  const out = join(root, 'shots');
  let server: { url: string; close(): Promise<void> } | undefined;
  try {
    cpSync(fixture, game, { recursive: true });
    const html = join(game, 'index.html');
    const source = readFileSync(html, 'utf8');
    const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('bridge fixture script missing');
    const ready =
      "send('ready', { protocol: 1, manifest, marks: [['fixture-ready', performance.now()]] }, message.id);";
    if (!script.includes(ready)) throw new Error('bridge fixture ready message changed');
    // The shell keeps its loading layer over a game until it reports a first frame and the end of loading.
    const loaded = `${ready} send('load.frame', {}); send('load.done', { ms: 0, fetchedBytes: 0, cachedBytes: 0, fetchedFiles: 0, cachedFiles: 0, persisted: null });`;
    const code = `${script.replace(ready, loaded)}\n${modes}`;
    let src = 'fixture.js';
    if (via === 'cache-plan') {
      src = `/a/${createHash('sha256').update(code).digest('hex')}.js`;
      mkdirSync(join(game, 'a'));
    }
    writeFileSync(join(game, src), code);
    writeFileSync(
      html,
      source
        .replace(
          '<style>',
          '<style>html:not(.bad), html:not(.bad) body { user-select: none; -webkit-touch-callout: none; }\n',
        )
        .replace(/<script type="module">[\s\S]*?<\/script>/, `<script type="module" src="${src}"></script>`),
    );
    if (via === 'url') server = await serveStatic(game);
    if (via === 'cache-plan') server = await cachePlanHost(game);
    const plan = {
      game: server ? { url: server.url } : { dist: game },
      modes: [
        { id: 'good', taps: ['Good'] },
        { id: 'bad', taps: ['Bad'] },
      ],
      seconds: 1,
      seed: 1,
      keys: [{ key: 'Space', action: 'hardDrop', drop: true }],
      software: process.env.GM_VERIFY_SOFTWARE_GL === '1',
      board: true,
      fast: true,
    };
    await exec(process.execPath, [runner, out, JSON.stringify(plan)], { timeout: 200_000 });
    const runs = JSON.parse(readFileSync(join(out, 'playtest.json'), 'utf8')) as PlaytestRun[];
    return { runs, stills: runs.map((run) => Boolean(run.still) && existsSync(join(out, run.still!))) };
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function expectVerdicts(runs: PlaytestRun[]) {
  expect(runs.map((run) => [run.mode, run.viewport])).toEqual([
    ['good', '390x844'],
    ['bad', '390x844'],
  ]);
  expect(runs[0]!.failures).toEqual([]);
  expect(runs[0]!.unchecked.filter((line) => !line.startsWith('clip:'))).toEqual([]);
  const bad = runs[1]!.failures.join('\n');
  expect(bad).toContain('2 boards on screen, expected one');
  expect(bad).toContain('board: overlap');
  expect(bad).toContain('long press selects text: "SCORE"');
  expect(bad).toContain('no -webkit-touch-callout:none on the page');
  expect(bad).toContain('game state: exactly one board');
  expect(bad).toContain('game state: every piece has a colour');
  expect(bad).toContain('console: board drawn twice');
}

it('fails only the broken mode, naming each defect, and leaves a still per mode', async () => {
  const { runs, stills } = await playFixture('dist');
  expectVerdicts(runs);
  expect(stills).toEqual([true, true]);
}, 220_000);

/* The post-publish run plays the hosted build (ogm-qa passes --url), not a local dist. */
it('plays a hosted build through --url with the same verdicts', async () => {
  const { runs } = await playFixture('url');
  expectVerdicts(runs);
}, 220_000);

/* Hosted builds since the cache plan (#1213) load scripts from `/a/` and need the host's query; the post-publish
 * capture failed on every one and Kevin's reviews carried stills instead of the gameplay clip (#1250). */
it('plays a hosted cache-plan build, reporting console errors from its shared scripts', async () => {
  const { runs } = await playFixture('cache-plan');
  expectVerdicts(runs);
}, 220_000);
