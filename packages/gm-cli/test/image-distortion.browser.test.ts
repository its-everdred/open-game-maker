import { execFile, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('../../../apps/web/e2e/fixtures/bridge-game/', import.meta.url));
const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));

it('fails gm check for stretched art and passes the same art as a nine-slice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gm-distortion-game-'));
  try {
    cpSync(fixture, join(root, 'source'), { recursive: true });
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify({ playArea: false }));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node build.cjs' } }));
    writeFileSync(join(root, 'build.cjs'), "require('node:fs').cpSync('source', 'dist', { recursive: true });");
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true }, include: ['src'] }));
    writeFileSync(
      join(root, 'src/main.ts'),
      'type GameModule = {}; declare const host: { test: { register(x: GameModule): void } }; const game: GameModule = {}; host.test.register(game);',
    );
    await sharp({ create: { width: 90, height: 30, channels: 4, background: '#994400' } })
      .png()
      .toFile(join(root, 'source/button.png'));
    const htmlPath = join(root, 'source/index.html');
    const original = readFileSync(htmlPath, 'utf8');
    const script = original.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('bridge fixture script missing');
    writeFileSync(join(root, 'source/fixture.js'), script);
    const html = original.replace(
      /<script type="module">[\s\S]*?<\/script>/,
      '<script type="module" src="fixture.js"></script>',
    );
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root });
    const check = () =>
      exec(process.execPath, [cli, 'check', '--json'], {
        cwd: root,
        env: { ...process.env, GM_VERIFY_SOFTWARE_GL: '1', XDG_RUNTIME_DIR: root },
        timeout: 600_000,
      });
    writeFileSync(
      htmlPath,
      html.replace(
        'Bridge fixture</div>',
        'Bridge fixture<img id="button-art" src="button.png" style="width:30px;height:30px"></div>',
      ),
    );
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const failed = await check().then(
      () => '',
      (error: { stdout: string }) => error.stdout,
    );
    expect(failed).toContain('button-art');
    expect(JSON.parse(failed).ok).toBe(false);
    writeFileSync(
      htmlPath,
      html.replace(
        'Bridge fixture</div>',
        'Bridge fixture<div id="button-frame" style="width:30px;height:30px;border:10px solid transparent;border-image:url(button.png) 10 fill / 10px stretch"></div></div>',
      ),
    );
    const passed = await check();
    expect(JSON.parse(passed.stdout).ok).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 1_300_000);
