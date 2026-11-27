import { spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedGlassFiles, glassScreens } from './glass-change-selection.mjs';

if (!process.env.CI) process.exit(0);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let files;
try {
  files = changedGlassFiles(root);
} catch {
  console.error('Glass parity cannot determine changed screens against origin/main');
  process.exit(1);
}
const screens = glassScreens(files);
let failed = screens.includes('Unmapped');
if (failed) {
  const unmapped = files.filter((file) => glassScreens([file]).includes('Unmapped'));
  console.error(
    `Glass parity has no capture for changed UI: ${unmapped.join(', ')}. Add a reviewed screen capture before merging.`,
  );
}
for (const screen of screens.filter((item) => item !== 'Unmapped')) {
  if (screen === 'Editor' && !process.env.OGM_GLASS_GAME_DIST) {
    console.log(
      'Post-deploy check: open the Blobs editor in the signed-in app on an iPhone and compare portrait and landscape with the approved Editor artboards (operator: physical iPhone).',
    );
    continue;
  }
  if (screen === 'Settings')
    console.log(
      'Post-deploy check: open Settings on a physical iPhone in landscape and compare it with the approved Settings layout (operator: physical iPhone).',
    );
  const run = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', 'e2e/glass-parity.spec.ts', '--project', 'desktop', '--workers=1'],
    {
      stdio: 'inherit',
      env: { ...process.env, OGM_GLASS_PARITY_SCREEN: screen },
    },
  );
  if (run.error || run.status !== 0) failed = true;
}
if (failed) process.exitCode = 1;
