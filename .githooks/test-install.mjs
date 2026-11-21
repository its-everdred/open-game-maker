import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = mkdtempSync(join(tmpdir(), 'ogm-hook-install-'));
try {
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('node', [join(root, 'scripts/install-hooks.mjs')], { cwd: repo });
  const hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo, encoding: 'utf8' }).trim();
  if (hooksPath !== '.githooks') throw new Error(`Unexpected hooks path: ${hooksPath}`);
  process.stdout.write('install script configures .githooks\n');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
