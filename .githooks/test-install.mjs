import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = mkdtempSync(join(tmpdir(), 'ogm-hook-install-'));
try {
  execFileSync('git', ['init', '-q', repo]);
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  mkdirSync(join(repo, 'scripts'));
  mkdirSync(join(repo, '.githooks'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { prepare: scripts.prepare } }));
  writeFileSync(join(repo, 'scripts/install-hooks.mjs'), readFileSync(join(root, 'scripts/install-hooks.mjs')));
  writeFileSync(join(repo, '.githooks/pre-commit'), readFileSync(join(root, '.githooks/pre-commit')));
  execFileSync('chmod', ['+x', join(repo, '.githooks/pre-commit')]);
  execFileSync('pnpm', ['install', '--ignore-workspace'], { cwd: repo, stdio: 'inherit' });
  const hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo, encoding: 'utf8' }).trim();
  if (hooksPath !== '.githooks') throw new Error(`Unexpected hooks path: ${hooksPath}`);
  accessSync(join(repo, hooksPath, 'pre-commit'), constants.X_OK);
  process.stdout.write('install script configures .githooks\n');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
