import { spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedGlassFiles, runGlassScreens } from './glass-change-selection.mjs';

if (!process.env.CI) process.exit(0);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let files;
try {
  files = changedGlassFiles(root);
} catch {
  console.error('Glass parity cannot determine changed screens against origin/main');
  process.exit(1);
}
process.exitCode = runGlassScreens(files, {
  gameDist: process.env.OGM_GLASS_GAME_DIST,
  log: console.log,
  error: console.error,
  run: (screens) => {
    const result = spawnSync(
      'pnpm',
      ['exec', 'playwright', 'test', 'e2e/glass-parity.spec.ts', '--project', 'desktop', '--workers=1'],
      { stdio: 'inherit', env: { ...process.env, OGM_GLASS_PARITY_SCREEN: screens.join(',') } },
    );
    return !result.error && result.status === 0;
  },
});
