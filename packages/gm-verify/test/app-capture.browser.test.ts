import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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
    writeFileSync(
      join(game, 'fixture.js'),
      `fetch('http://127.0.0.1:${port}/').then(() => { document.querySelector('button').textContent = 'LEAKED'; }, () => { document.querySelector('button').textContent = 'Start'; });\n${script}`,
    );
    writeFileSync(
      html,
      source
        .replace('Bridge fixture</div>', '<button>Waiting</button><img src="café scene.png" alt=""> </div>')
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
      [runner, game, out, '["Start"]', '1', '0', process.env.GM_VERIFY_SOFTWARE_GL === '1' ? '1' : '0', '--test-fast'],
      { timeout: 240_000 },
    );
    for (const size of ['390x844']) {
      for (const screen of ['play', 'ingame', 'menu', 'edit']) {
        expect(existsSync(join(out, `${screen}-${size}.png`))).toBe(true);
      }
    }
    expect(externalRequests).toBe(0);
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
