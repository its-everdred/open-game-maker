import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('../../../apps/web/e2e/fixtures/bridge-game/', import.meta.url));
const runner = fileURLToPath(new URL('../dist/app-capture/runner.js', import.meta.url));

it('captures play, game, menu and edit in the packaged app with a touch viewport', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gm-app-capture-test-'));
  const game = join(root, 'game');
  const out = join(root, 'shots');
  try {
    cpSync(fixture, game, { recursive: true });
    const html = join(game, 'index.html');
    const source = readFileSync(html, 'utf8');
    const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('bridge fixture script missing');
    const sdk = await build({
      stdin: {
        contents: `import { installGlobals } from './globals.ts'; import { beginImageDraws, reportImageDraw } from './image-draws.ts';
          installGlobals({ ready: true, marks: [], advanceTime() {}, renderAt() {}, renderGameToText() {} }, 'draft');
          setInterval(() => { beginImageDraws();
            reportImageDraw({ id: 'sdk-sprite', file: 'sprite.png', source: { width: 90, height: 30 }, drawn: { width: 30, height: 30 } }); }, 100);`,
        resolveDir: fileURLToPath(new URL('../../sdk/src/test/', import.meta.url)),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
    });
    writeFileSync(
      join(game, 'fixture.js'),
      `${sdk.outputFiles[0]!.text}\nlet __lateAdded = false; const __decode = Image.prototype.decode; Image.prototype.decode = function() { if (__lateAdded) return __decode.call(this); __lateAdded = true; setTimeout(() => { const image = document.createElement('img'); image.id = 'late'; image.src = 'café scene.png'; image.style.cssText = 'width:90px;height:30px'; document.querySelector('#canvas').append(image); }, 25); return new Promise((resolve) => setTimeout(resolve, 100)).then(() => __decode.call(this)); };\ndocument.querySelector('button').textContent = 'Start';\n${script}`,
    );
    writeFileSync(
      html,
      source
        .replace(
          'Bridge fixture</div>',
          '<button data-gm-play-area>Waiting</button><img id="stretched" src="café scene.png" alt="" style="width:90px;height:30px"><div style="width:90px;height:30px;background:url(\'café scene.png\') 0 0 / 90px 30px"></div> </div>',
        )
        .replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="fixture.js"></script>'),
    );
    writeFileSync(
      join(game, 'café scene.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVnQAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    await exec(
      process.execPath,
      [
        runner,
        game,
        out,
        '["Start"]',
        '1',
        '0',
        process.env.GM_VERIFY_SOFTWARE_GL === '1' ? '1' : '0',
        '--test-all-fast',
      ],
      { timeout: 240_000 },
    );
    for (const size of ['390x844', '844x390', '820x1180', '1180x820']) {
      for (const screen of ['play', 'ingame', 'menu', 'edit']) {
        expect(existsSync(join(out, `${screen}-${size}.png`))).toBe(true);
      }
    }
    const distortions = JSON.parse(readFileSync(join(out, 'image-distortion.json'), 'utf8')) as {
      element: string;
      viewport: string;
      screen: string;
    }[];
    for (const viewport of ['390x844', '844x390', '820x1180', '1180x820'])
      expect(distortions).toContainEqual(expect.objectContaining({ element: '#stretched', viewport, screen: 'play' }));
    expect(distortions).toContainEqual(expect.objectContaining({ element: '#late', screen: 'play' }));
    expect(distortions).toContainEqual(expect.objectContaining({ element: '#stretched', screen: 'after Start' }));
    expect(distortions).toContainEqual(expect.objectContaining({ element: 'sdk-sprite', screen: 'play' }));
    expect(distortions.filter((item) => item.element === 'document')).toEqual([]);
    expect(JSON.parse(readFileSync(join(out, 'play-area.json'), 'utf8'))).toMatchObject(
      ['390x844', '844x390', '820x1180', '1180x820'].flatMap((viewport) =>
        ['play', 'ingame', 'menu', 'edit'].map((screen) => ({ viewport, screen, ok: false })),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 250_000);

// The games host's CSP refuses a game's request to another origin; the capture fails on it rather than passing a game
// that works only without prod's headers.
it('fails on a CSP violation in the game, and the blocked request never leaves', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gm-app-capture-csp-'));
  const game = join(root, 'game');
  let externalRequests = 0;
  const external = createServer((_request, response) => {
    externalRequests += 1;
    response.writeHead(200, { 'access-control-allow-origin': '*' }).end('unexpected');
  });
  await new Promise<void>((resolve) => external.listen(0, '127.0.0.1', resolve));
  const port = (external.address() as AddressInfo).port;
  try {
    cpSync(fixture, game, { recursive: true });
    const html = join(game, 'index.html');
    const source = readFileSync(html, 'utf8');
    const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('bridge fixture script missing');
    writeFileSync(join(game, 'fixture.js'), `fetch('http://127.0.0.1:${port}/').catch(() => {});\n${script}`);
    writeFileSync(
      html,
      source.replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="fixture.js"></script>'),
    );
    await expect(
      exec(
        process.execPath,
        [
          runner,
          game,
          join(root, 'shots'),
          '[]',
          '0',
          '0',
          process.env.GM_VERIFY_SOFTWARE_GL === '1' ? '1' : '0',
          '--test-fast',
        ],
        { timeout: 120_000 },
      ),
    ).rejects.toThrow(/CSP violation: connect-src blocked http:\/\/127\.0\.0\.1:\d+\//);
    expect(externalRequests).toBe(0);
  } finally {
    await new Promise<void>((resolve) => external.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}, 130_000);

it('fails instead of publishing stills when the game never connects', async () => {
  expect(existsSync(runner)).toBe(true);
  const root = mkdtempSync(join(tmpdir(), 'gm-app-capture-broken-'));
  const game = join(root, 'game');
  const out = join(root, 'shots');
  try {
    cpSync(fixture, game, { recursive: true });
    const html = join(game, 'index.html');
    writeFileSync(html, readFileSync(html, 'utf8').replace(/<script type="module">[\s\S]*?<\/script>/, ''));
    await expect(
      exec(
        process.execPath,
        [runner, game, out, '[]', '0', '0', process.env.GM_VERIFY_SOFTWARE_GL === '1' ? '1' : '0', '--test-fast'],
        { timeout: 60_000 },
      ),
    ).rejects.toThrow();
    expect(existsSync(join(out, 'play-390x844.png'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 70_000);

it('reports a board hidden by an ancestor without stopping capture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gm-app-capture-hidden-'));
  const game = join(root, 'game');
  try {
    cpSync(fixture, game, { recursive: true });
    const html = join(game, 'index.html');
    const source = readFileSync(html, 'utf8');
    const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('fixture script missing');
    writeFileSync(join(game, 'fixture.js'), script);
    writeFileSync(
      html,
      source
        .replace('Bridge fixture</div>', '<div style="opacity:0"><div data-gm-play-area>Board</div></div></div>')
        .replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="fixture.js"></script>'),
    );
    await exec(
      process.execPath,
      [
        runner,
        game,
        join(root, 'shots'),
        '[]',
        '0',
        '0',
        process.env.GM_VERIFY_SOFTWARE_GL === '1' ? '1' : '0',
        '--test-fast',
      ],
      { timeout: 90_000 },
    );
    expect(readFileSync(join(root, 'shots/play-area.json'), 'utf8')).toContain('play area is hidden');
    expect(existsSync(join(root, 'shots/menu-390x844.png'))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 100_000);

it('captures every still when no play area is declared', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gm-app-capture-undeclared-'));
  const game = join(root, 'game');
  const out = join(root, 'shots');
  try {
    cpSync(fixture, game, { recursive: true });
    const html = join(game, 'index.html');
    const source = readFileSync(html, 'utf8');
    const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('fixture script missing');
    writeFileSync(join(game, 'fixture.js'), script);
    writeFileSync(
      html,
      source.replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="fixture.js"></script>'),
    );
    await exec(
      process.execPath,
      [runner, game, out, '[]', '0', '0', process.env.GM_VERIFY_SOFTWARE_GL === '1' ? '1' : '0', '--test-all-fast'],
      { timeout: 240_000 },
    );
    for (const size of ['390x844', '844x390', '820x1180', '1180x820']) {
      for (const screen of ['play', 'menu']) expect(existsSync(join(out, `${screen}-${size}.png`))).toBe(true);
    }
    expect(JSON.parse(readFileSync(join(out, 'play-area.json'), 'utf8'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ viewport: '390x844', ok: false, error: expect.stringContaining('not declared') }),
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 250_000);

it('measures the board separately before and after game actions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gm-app-capture-overlap-'));
  const game = join(root, 'game');
  try {
    cpSync(fixture, game, { recursive: true });
    const html = join(game, 'index.html');
    const source = readFileSync(html, 'utf8');
    const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('fixture script missing');
    writeFileSync(
      join(game, 'fixture.js'),
      `${script.replace("send('ready', { protocol: 1, manifest, marks: [['fixture-ready', performance.now()]] }, message.id);", "send('ready', { protocol: 1, manifest, marks: [['fixture-ready', performance.now()]] }, message.id); send('load.frame', {}); send('load.done', { ms: 0, fetchedBytes: 0, cachedBytes: 0, fetchedFiles: 0, cachedFiles: 0, persisted: null });")}
document.querySelector('#start').addEventListener('click', () => { document.querySelector('[data-gm-play-area]').style.visibility = 'visible'; const hud = document.querySelector('#hud'); hud.style.left = '30px'; hud.setAttribute('aria-label', 'play area is hidden'); hud.removeAttribute('id'); });`,
    );
    writeFileSync(
      html,
      source
        .replace(
          'Bridge fixture</div>',
          '<div data-gm-play-area style="visibility:hidden;position:absolute;left:30px;top:100px;width:200px;height:500px"></div><button id="start" style="position:absolute;left:260px;top:50px">Start</button><div id="hud" style="position:absolute;left:260px;top:100px;width:100px;height:30px;background:red">Score</div></div>',
        )
        .replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="fixture.js"></script>'),
    );
    await exec(
      process.execPath,
      [
        runner,
        game,
        join(root, 'shots'),
        '["Start"]',
        '0',
        '0',
        process.env.GM_VERIFY_SOFTWARE_GL === '1' ? '1' : '0',
        '--test-fast',
        '{"minFill":0,"maxOffset":1}',
      ],
      { timeout: 90_000 },
    );
    const results = JSON.parse(readFileSync(join(root, 'shots/play-area.json'), 'utf8'));
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ screen: 'play', ok: true, skipped: true }),
        expect.objectContaining({
          screen: 'ingame',
          ok: false,
          error: expect.stringContaining('overlap: play area is hidden'),
        }),
      ]),
    );
    const js = join(game, 'fixture.js');
    writeFileSync(js, readFileSync(js, 'utf8').replace("style.visibility = 'visible'", "style.visibility = 'hidden'"));
    writeFileSync(
      html,
      readFileSync(html, 'utf8').replace('visibility:hidden;position:absolute', 'visibility:visible;position:absolute'),
    );
    await exec(
      process.execPath,
      [
        runner,
        game,
        join(root, 'second'),
        '["Start"]',
        '0',
        '0',
        process.env.GM_VERIFY_SOFTWARE_GL === '1' ? '1' : '0',
        '--test-fast',
        '{"minFill":0,"maxOffset":1}',
      ],
      { timeout: 90_000 },
    );
    const hiddenAfterTap = JSON.parse(readFileSync(join(root, 'second/play-area.json'), 'utf8'));
    expect(hiddenAfterTap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ screen: 'ingame', ok: false, error: expect.stringContaining('play area is hidden') }),
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 100_000);
