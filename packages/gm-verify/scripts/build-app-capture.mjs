// Bundle the real web app into the same package as the portable capture runner.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, '..', '..', 'apps', 'web');
execFileSync('pnpm', ['exec', 'vite', 'build', '--outDir', join(root, 'dist', 'app-capture', 'web'), '--emptyOutDir'], {
  cwd: web,
  env: { ...process.env, VITE_GAMES_ORIGIN: 'http://127.0.0.1:10000' },
  stdio: 'inherit',
});
