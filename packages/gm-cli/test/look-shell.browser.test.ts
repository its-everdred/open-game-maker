import { execFile, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('../../../apps/web/e2e/fixtures/bridge-game/', import.meta.url));
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const sandboxAvailable =
  spawnSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-net', '--', '/bin/true'])
    .status === 0;

it.skipIf(!sandboxAvailable)(
  'captures all touch views with only the workspace writable in bwrap',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'gm-shell-sandbox-'));
    try {
      cpSync(fixture, join(root, 'dist'), { recursive: true });
      mkdirSync(join(root, 'runtime/ogm-verify'), { recursive: true });
      const html = join(root, 'dist/index.html');
      const source = readFileSync(html, 'utf8');
      const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
      if (!script) throw new Error('bridge fixture script missing');
      writeFileSync(join(root, 'dist/fixture.js'), script);
      writeFileSync(
        html,
        source.replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="fixture.js"></script>'),
      );
      const env: NodeJS.ProcessEnv = {
        PATH: '/usr/bin:/bin',
        HOME: '/home/sandbox',
        GM_VERIFY_SOFTWARE_GL: '1',
        XDG_RUNTIME_DIR: '/usr/local',
        PLAYWRIGHT_BROWSERS_PATH: '/mnt',
      };
      const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME!, '.cache/ms-playwright');
      await exec(
        'bwrap',
        [
          '--ro-bind',
          '/',
          '/',
          '--dev',
          '/dev',
          '--proc',
          '/proc',
          '--ro-bind',
          repo,
          '/opt',
          ...(existsSync(join(repo, '.aiur-runtime')) ? ['--tmpfs', '/opt/.aiur-runtime'] : []),
          '--ro-bind',
          process.execPath,
          '/bin/false',
          '--ro-bind',
          browsers,
          '/mnt',
          '--bind',
          root,
          '/srv',
          '--ro-bind',
          join(root, 'runtime'),
          '/usr/local',
          '--tmpfs',
          '/home',
          '--unshare-net',
          '--chdir',
          '/srv',
          '--',
          '/bin/false',
          '/opt/packages/gm-cli/dist/index.js',
          'look',
          'shell',
          '--dist',
          'dist',
          '--out',
          'shots',
          '--timeout',
          '600',
        ],
        { env, timeout: 650_000 },
      );
      for (const size of ['390x844', '844x390', '820x1180', '1180x820']) {
        for (const screen of ['play', 'menu'])
          expect(existsSync(join(root, 'shots', `${screen}-${size}.png`))).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  660_000,
);
