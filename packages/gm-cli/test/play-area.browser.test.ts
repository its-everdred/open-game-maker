import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { gm, tempDir } from './helpers.js';

it('fails gm check for a real small board and identifies its viewport', async () => {
  const root = tempDir();
  const fixture = fileURLToPath(new URL('../../../apps/web/e2e/fixtures/bridge-game/', import.meta.url));
  try {
    cpSync(fixture, join(root, 'dist'), { recursive: true });
    const html = join(root, 'dist/index.html');
    const source = readFileSync(html, 'utf8');
    const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('fixture script missing');
    writeFileSync(join(root, 'dist/fixture.js'), script);
    writeFileSync(
      html,
      source
        .replace('Bridge fixture</div>', '<div data-gm-play-area style="width:100px;height:100px">Board</div></div>')
        .replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="fixture.js"></script>'),
    );
    cpSync(join(root, 'dist'), join(root, 'source'), { recursive: true });
    writeFileSync(join(root, 'build.cjs'), "require('node:fs').cpSync('source', 'dist', { recursive: true })");
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { build: 'node build.cjs' }, dependencies: { '@gm/sdk': '*' } }),
    );
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'design'));
    writeFileSync(join(root, 'src/main.ts'), '');
    writeFileSync(join(root, 'index.html'), '');
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root });
    git('init', '-q');
    git('add', 'package.json');
    git('commit', '-qm', 'fixture');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const result = await gm(['check'], {
      cwd: root,
      env: { ...process.env, GM_VERIFY_SOFTWARE_GL: '1', XDG_RUNTIME_DIR: root },
    });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('at 1180x820');
    expect(result.err.join('\n')).toContain('board fill');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 240_000);
