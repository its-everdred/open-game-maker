import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('./pre-commit', import.meta.url));
const prettier = fileURLToPath(new URL('../node_modules/prettier/bin/prettier.cjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'ogm-pre-commit-'));
const run = (args, options = {}) => execFileSync('git', args, { cwd: root, stdio: 'pipe', ...options });

try {
  run(['init', '-q']);
  writeFileSync(join(root, 'file.js'), 'const value = {a:1};\n');
  run(['add', 'file.js']);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const pnpm = join(bin, 'pnpm');
  writeFileSync(pnpm, `#!/bin/sh\nshift 2\nexec "${process.execPath}" "${prettier}" "$@"\n`);
  chmodSync(pnpm, 0o755);
  execFileSync(hook, [], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: 'inherit' });
  const formatted = readFileSync(join(root, 'file.js'), 'utf8');
  if (formatted !== 'const value = { a: 1 };\n') throw new Error(`Unexpected formatting: ${formatted}`);
  const staged = run(['show', ':file.js'], { encoding: 'utf8' }).toString();
  if (staged !== formatted) throw new Error('Formatted content was not staged');
  process.stdout.write('pre-commit hook formats and stages changed files\n');
} finally {
  rmSync(root, { recursive: true, force: true });
}
