import { execFileSync } from 'node:child_process';
import { glassDiffBase } from './glass-git-base.mjs';

export function changedGlassFiles(root, base) {
  const fields = execFileSync(
    'git',
    [
      'diff',
      '--name-status',
      '-z',
      '--no-renames',
      '--diff-filter=ACMRD',
      base ? `${base}...HEAD` : glassDiffBase(root),
      '--',
      'apps/web/src',
      'apps/web/public',
    ],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean);
  const files = [];
  for (let i = 0; i < fields.length; i += 2) {
    const status = fields[i];
    const file = fields[i + 1];
    if (!file) throw new Error('Incomplete git diff output');
    // Initial library additions have no existing consumers. A route importing them
    // is itself selected; subsequent changes to shared code must fail closed.
    if (
      status === 'A' &&
      (file === 'apps/web/src/glass-tokens.css' || file.startsWith('apps/web/src/components/glass/'))
    )
      continue;
    files.push(file);
  }
  return files;
}

/** Screens whose owned routes or UI changed. Unsupported screens fail closed in CI. */
export function glassScreens(files) {
  const screens = new Set();
  for (const file of files) {
    if (/\.(?:test|spec)\.[^.]+$/.test(file)) continue;
    if (file.startsWith('apps/web/src/routes/new/')) {
      screens.add('NewGame');
      if (/NewGameChat|scope-chat/.test(file)) screens.add('Unmapped');
    } else if (file.startsWith('apps/web/src/routes/signin/') || file.startsWith('apps/web/src/routes/login/')) {
      screens.add('SignIn');
    } else if (file === 'apps/web/src/routes/auth.css') {
      screens.add('SignIn');
      screens.add('Unmapped');
    } else if (file.startsWith('apps/web/src/routes/games/')) {
      screens.add('Home');
      if (/GameDetail|games-responsive\.css/.test(file)) screens.add('Unmapped');
    } else if (file.startsWith('apps/web/src/routes/settings/')) {
      screens.add('Settings');
      if (/CreditsScreen|CreditsList/.test(file)) screens.add('Unmapped');
    } else if (
      file.startsWith('apps/web/src/features/editor/') ||
      /apps\/web\/src\/routes\/game\/(?:EditWorkspace|edit-workspace)/.test(file)
    )
      screens.add('Editor');
    else if (file.startsWith('apps/web/src/routes/') && /\.(?:tsx|css)$/.test(file)) screens.add('Unmapped');
    else if (
      /^apps\/web\/src\/features\/(?:room|game-menu|build-chat|scope-chat|commands-inbox|worker-builds)\//.test(file) &&
      /\.(?:tsx|css)$/.test(file)
    )
      screens.add('Unmapped');
    else if (file.startsWith('apps/web/public/')) screens.add('Unmapped');
    else if (file.startsWith('apps/web/src/') && /\.(?:tsx|css)$/.test(file)) screens.add('Unmapped');
  }
  return [...screens].sort();
}

/** Run selected captures, preserving a failure for any uncovered screen or failed comparison. */
export function runGlassScreens(files, { gameDist, run, log, error }) {
  const screens = glassScreens(files);
  let failed = screens.includes('Unmapped');
  if (failed) {
    const unmapped = files.filter((file) => glassScreens([file]).includes('Unmapped'));
    error(
      `Glass parity has no capture for changed UI: ${unmapped.join(', ')}. Add a reviewed screen capture before merging.`,
    );
  }
  for (const screen of screens.filter((item) => item !== 'Unmapped')) {
    if (screen === 'Editor' && !gameDist) {
      log(
        'Post-deploy check: open the Blobs editor in the signed-in app on a physical iPhone and compare portrait and landscape with the approved Editor artboards (operator: physical iPhone).',
      );
      continue;
    }
    if (screen === 'Settings')
      log(
        'Post-deploy check: open Settings on a physical iPhone in landscape and compare it with the approved Settings layout (operator: physical iPhone).',
      );
    if (!run(screen)) failed = true;
  }
  return failed ? 1 : 0;
}
