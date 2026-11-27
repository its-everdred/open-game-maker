import { execFileSync } from 'node:child_process';
import { glassDiffBase } from './glass-git-base.mjs';

const coveredScreens = ['Title', 'Home', 'Editor', 'Settings', 'SignIn', 'NewGame', 'GameSheet', 'Admin', 'Activity'];
const references = {
  Title: 'Title',
  SignIn: 'SignIn',
  NewGame: 'NewGame',
  GameSheet: 'GameSheet',
  Admin: 'Admin',
  Activity: 'Activity',
  Home: 'Home',
  HomeLandscape: 'Home',
  HomeDesktop: 'Home',
  Editor: 'Editor',
  EditorLandscape: 'Editor',
  EditorDesktop: 'Editor',
  Settings: 'Settings',
};

export function changedGlassFiles(root, base) {
  const range = base ? `${base}...HEAD` : glassDiffBase(root);
  const baseRef = range.split('..')[0];
  let hasGlassLibrary = false;
  try {
    execFileSync('git', ['cat-file', '-e', `${baseRef}:apps/web/src/components/glass/index.ts`], {
      cwd: root,
      stdio: 'ignore',
    });
    hasGlassLibrary = true;
  } catch {
    // The initial library has no consumers in the base revision.
  }
  const fields = execFileSync(
    'git',
    [
      'diff',
      '--name-status',
      '-z',
      '--no-renames',
      '--diff-filter=ACMRD',
      range,
      '--',
      'apps/web/src',
      'apps/web/public',
      'apps/web/title-town',
      'apps/web/package.json',
      'apps/web/playwright.config.ts',
      'apps/web/tools',
      'apps/web/e2e/fixtures/glass',
      'apps/web/e2e/glass-parity.spec.ts',
      'apps/web/e2e/support/parity-bridge.ts',
      'apps/web/e2e/support/parity-editor-route.ts',
      'apps/web/e2e/support/parity-viewport.ts',
      'apps/web/e2e/support/parity-selection.ts',
      'apps/web/e2e/support/parity-title.ts',
      'apps/web/e2e/support/shell-capture-files.ts',
      'apps/web/e2e/support/mock-game-api.ts',
      'apps/web/e2e/support/stage-prototype-fixture.mjs',
      'apps/web/e2e/fixtures/auth-routes.ts',
      'apps/web/e2e/fixtures/games-routes.ts',
      'apps/web/e2e/fixtures/new-routes.ts',
      'packages/gm-cli/src/design-parity',
      'tests/design-baselines/ogm-glass',
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
      !hasGlassLibrary &&
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
    if (file.startsWith('tests/design-baselines/ogm-glass/') && file.endsWith('.png')) {
      const artboard = file.slice(file.lastIndexOf('/') + 1).split('-')[0];
      screens.add(Object.hasOwn(references, artboard) ? references[artboard] : 'Unmapped');
      continue;
    }
    if (
      file === 'apps/web/e2e/glass-parity.spec.ts' ||
      file === 'apps/web/package.json' ||
      file === 'apps/web/playwright.config.ts' ||
      file.startsWith('apps/web/e2e/fixtures/glass/') ||
      /^apps\/web\/tools\/(?:glass-|generate-glass-tokens|import-glass-exports)/.test(file) ||
      /^apps\/web\/e2e\/support\/(?:mock-game-api\.ts|stage-prototype-fixture\.mjs)$/.test(file) ||
      /^apps\/web\/e2e\/(?:support\/(?:parity-(?:bridge|editor-route|viewport|selection|title)|shell-capture-files)|fixtures\/(?:auth|games|new)-routes)\.ts$/.test(
        file,
      ) ||
      (file.startsWith('packages/gm-cli/src/design-parity/') && !/\.test\.ts$/.test(file)) ||
      /^tests\/design-baselines\/ogm-glass\/(?:manifest|masks)\.json$/.test(file)
    ) {
      for (const screen of coveredScreens) screens.add(screen);
      screens.add('Unmapped');
      continue;
    }
    if (/\.(?:test|spec)\.[^.]+$/.test(file)) continue;
    if (file.startsWith('apps/web/src/routes/title/') || file.startsWith('apps/web/title-town/')) {
      screens.add('Title');
    } else if (file.startsWith('apps/web/src/features/worker-builds/')) {
      screens.add('Activity');
      screens.add('Unmapped');
    } else if (file.startsWith('apps/web/src/routes/admin/')) {
      screens.add('Admin');
      if (!file.endsWith('/Members.tsx')) screens.add('Unmapped');
    } else if (file.startsWith('apps/web/src/routes/new/')) {
      screens.add('NewGame');
      screens.add('Unmapped');
    } else if (file.startsWith('apps/web/src/routes/signin/')) {
      screens.add('SignIn');
    } else if (file.startsWith('apps/web/src/routes/login/')) {
      screens.add('SignIn');
      screens.add('Unmapped');
    } else if (file === 'apps/web/src/routes/auth.css') {
      screens.add('SignIn');
      screens.add('Unmapped');
    } else if (file.startsWith('apps/web/src/routes/games/')) {
      screens.add('Home');
      screens.add('GameSheet');
    } else if (file.startsWith('apps/web/src/routes/settings/')) {
      screens.add('Settings');
      if (/CreditsScreen|CreditsList|settings\.css|\/route\.tsx$/.test(file)) screens.add('Unmapped');
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
    else if (file.startsWith('apps/web/src/')) screens.add('Unmapped');
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
  const runnable = [];
  for (const screen of screens.filter((item) => item !== 'Unmapped')) {
    if (screen === 'Editor' && !gameDist) {
      error('Glass parity requires OGM_GLASS_GAME_DIST pointing to a real built game for the Editor capture.');
      failed = true;
      continue;
    }
    if (screen === 'Settings')
      log(
        'Post-deploy check: open Settings on a physical iPhone in landscape and compare it with the approved Settings layout (operator: physical iPhone).',
      );
    runnable.push(screen);
  }
  if (runnable.length && !run(runnable)) failed = true;
  return failed ? 1 : 0;
}
