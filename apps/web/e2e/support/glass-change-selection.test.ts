import { expect, it, vi } from 'vitest';
import { glassScreens } from '../../tools/glass-change-selection.mjs';

it('selects affected screens and fails closed on other visible routes', () => {
  expect(
    glassScreens(['apps/web/src/routes/games/GamesScreen.tsx', 'apps/web/src/routes/settings/settings.css']),
  ).toEqual(['GameSheet', 'Home', 'Settings', 'Unmapped']);
  expect(glassScreens(['apps/web/src/features/editor/EditorChrome.tsx'])).toEqual(['Editor']);
  expect(glassScreens(['apps/web/src/routes/signin/SignInScreen.tsx'])).toEqual(['SignIn']);
  expect(glassScreens(['apps/web/src/routes/new/NewGameScreen.tsx'])).toEqual(['NewGame', 'Unmapped']);
  expect(glassScreens(['apps/web/src/routes/new/StyleStep.tsx'])).toEqual(['NewGame', 'Unmapped']);
  expect(glassScreens(['apps/web/src/routes/login/route.tsx'])).toEqual(['SignIn', 'Unmapped']);
  expect(glassScreens(['apps/web/src/icons.ts'])).toEqual(['Unmapped']);
  expect(glassScreens(['apps/web/src/routes/games/showcase-data.json'])).toEqual(['GameSheet', 'Home']);
  expect(glassScreens(['apps/web/src/shared-visual.json'])).toEqual(['Unmapped']);
  expect(glassScreens(['apps/web/src/routes/admin/Members.tsx'])).toEqual(['Admin']);
  expect(glassScreens(['apps/web/src/routes/admin/admin.css'])).toEqual(['Admin', 'Unmapped']);
  expect(glassScreens(['apps/web/src/features/worker-builds/BuildTracker.tsx'])).toEqual(['Activity', 'Unmapped']);
  expect(glassScreens(['apps/web/src/routes/auth.css'])).toEqual(['SignIn', 'Unmapped']);
  expect(glassScreens(['apps/web/src/routes/title/TitleScreen.tsx'])).toEqual(['Title']);
  expect(glassScreens(['apps/web/title-town/city.js'])).toEqual(['Title']);
  expect(glassScreens(['apps/web/src/routes/games/GameDetail.tsx'])).toEqual(['GameSheet', 'Home']);
  expect(glassScreens(['apps/web/src/components/GlassButton.tsx'])).toEqual(['Unmapped']);
  expect(glassScreens(['apps/web/public/new-image.png'])).toEqual(['Unmapped']);
  expect(glassScreens(['apps/web/src/glass-tokens.css'])).toEqual(['Unmapped']);
  expect(glassScreens(['apps/web/src/routes/games/GamesScreen.test.tsx'])).toEqual([]);
  expect(glassScreens(['tests/design-baselines/ogm-glass/HomeDesktop-1440x900.png'])).toEqual(['Home']);
  expect(glassScreens(['tests/design-baselines/ogm-glass/Join-780x1688.png'])).toEqual(['Unmapped']);
  expect(glassScreens(['tests/design-baselines/ogm-glass/__proto__-1x1.png'])).toEqual(['Unmapped']);
  for (const file of [
    'apps/web/e2e/glass-parity.spec.ts',
    'apps/web/e2e/support/parity-title.ts',
    'apps/web/e2e/support/parity-coverage.ts',
    'apps/web/e2e/fixtures/glass/blobs-thumbnail.png',
    'apps/web/tools/glass-parity-ci.mjs',
    'apps/web/playwright.config.ts',
    'packages/gm-cli/src/design-parity/metrics.ts',
    'tests/design-baselines/ogm-glass/masks.json',
  ]) {
    expect(glassScreens([file])).toContain('Unmapped');
    expect(glassScreens([file])).toContain('Home');
  }
});

it('finds changed screen files from the repository root', async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { changedGlassFiles } = await import('../../tools/glass-change-selection.mjs');
  const root = await mkdtemp(join(tmpdir(), 'glass-changes-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    await writeFile(join(root, 'README'), 'base');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await mkdir(join(root, 'apps/web/src/routes/games'), { recursive: true });
    await writeFile(join(root, 'apps/web/src/routes/games/View.tsx'), 'export {}');
    git('add', '.');
    git('commit', '-qm', 'screen');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual(['GameSheet', 'Home']);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('rm', 'apps/web/src/routes/games/View.tsx');
    git('commit', '-qm', 'remove screen');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual(['GameSheet', 'Home']);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await mkdir(join(root, 'apps/web/src'), { recursive: true });
    await writeFile(join(root, 'apps/web/src/glass-tokens.css'), ':root {}');
    git('add', '.');
    git('commit', '-qm', 'add tokens');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual([]);
    await mkdir(join(root, 'apps/web/src/components/glass'), { recursive: true });
    await writeFile(join(root, 'apps/web/src/components/glass/Glass.tsx'), 'export {}');
    await writeFile(join(root, 'apps/web/src/components/glass/index.ts'), 'export {}');
    git('add', '.');
    git('commit', '-qm', 'add library');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual([]);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await writeFile(join(root, 'apps/web/src/components/glass/Another.tsx'), 'export {}');
    git('add', '.');
    git('commit', '-qm', 'add another shared component');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual(['Unmapped']);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await writeFile(join(root, 'apps/web/src/components/glass/Glass.tsx'), 'export const changed = true');
    git('add', '.');
    git('commit', '-qm', 'change library');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual(['Unmapped']);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await writeFile(join(root, 'apps/web/src/glass-tokens.css'), ':root { color: red }');
    git('add', '.');
    git('commit', '-qm', 'change tokens');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual(['Unmapped']);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('rm', 'apps/web/src/glass-tokens.css');
    git('commit', '-qm', 'remove tokens');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await writeFile(join(root, 'apps/web/src/glass-tokens.css'), ':root {}');
    git('add', '.');
    git('commit', '-qm', 'restore tokens');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual(['Unmapped']);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await mkdir(join(root, 'tests/design-baselines/ogm-glass'), { recursive: true });
    await writeFile(join(root, 'tests/design-baselines/ogm-glass/Home-780x1688.png'), 'reference');
    git('add', '.');
    git('commit', '-qm', 'add parity reference');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual(['Home']);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await mkdir(join(root, 'apps/web/title-town'), { recursive: true });
    await writeFile(join(root, 'apps/web/title-town/city.js'), 'export {}');
    git('add', '.');
    git('commit', '-qm', 'change title town');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual(['Title']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

it('runs covered screens and fails when a screen or real editor game is missing', async () => {
  const { runGlassScreens } = await import('../../tools/glass-change-selection.mjs');
  const run = vi.fn(() => true);
  const log = vi.fn();
  const error = vi.fn();
  expect(
    runGlassScreens(['apps/web/src/routes/games/GamesScreen.tsx', 'apps/web/src/routes/unmapped/View.tsx'], {
      run,
      log,
      error,
    }),
  ).toBe(1);
  expect(run).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledWith(['GameSheet', 'Home']);
  expect(error).toHaveBeenCalledOnce();
  run.mockClear();
  expect(runGlassScreens(['apps/web/src/features/editor/EditorChrome.tsx'], { run, log, error })).toBe(1);
  expect(run).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(expect.stringContaining('requires OGM_GLASS_GAME_DIST'));
  expect(
    runGlassScreens(['apps/web/src/features/editor/EditorChrome.tsx', 'apps/web/src/routes/signin/SignInScreen.tsx'], {
      run,
      log,
      error,
    }),
  ).toBe(1);
  expect(run).toHaveBeenCalledWith(['SignIn']);
  run.mockClear();
  expect(
    runGlassScreens(['apps/web/src/features/editor/EditorChrome.tsx'], {
      gameDist: '/real-game/dist',
      run,
      log,
      error,
    }),
  ).toBe(0);
  expect(run).toHaveBeenCalledWith(['Editor']);
  run.mockReturnValue(false);
  expect(runGlassScreens(['apps/web/src/routes/games/GamesScreen.tsx'], { run, log, error })).toBe(1);
});
