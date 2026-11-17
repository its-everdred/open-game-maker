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
      `${sdk.outputFiles[0]!.text}\nlet __lateAdded = false; const __decode = Image.prototype.decode; Image.prototype.decode = function() { if (__lateAdded) return __decode.call(this); __lateAdded = true; setTimeout(() => { const image = document.createElement('img'); image.id = 'late'; image.src = 'café scene.png'; image.style.cssText = 'width:90px;height:30px'; document.querySelector('#canvas').append(image); }, 25); return new Promise((resolve) => setTimeout(resolve, 100)).then(() => __decode.call(this)); };\nfetch('http://127.0.0.1:${port}/').then(() => { document.querySelector('button').textContent = 'LEAKED'; }, () => { document.querySelector('button').textContent = 'Start'; });\n${script}`,
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
    expect(externalRequests).toBe(0);
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
      ['390x844', '844x390', '820x1180', '1180x820'].map((viewport) => ({ viewport, ok: false })),
    );
  } finally {
    await new Promise<void>((resolve) => external.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}, 250_000);

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
