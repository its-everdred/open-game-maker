import { expect, it, vi } from 'vitest';
import { glassScreens } from '../../tools/glass-change-selection.mjs';

it('selects affected screens and fails closed on other visible routes', () => {
  expect(
    glassScreens(['apps/web/src/routes/games/GamesScreen.tsx', 'apps/web/src/routes/settings/settings.css']),
  ).toEqual(['Home', 'Settings']);
  expect(glassScreens(['apps/web/src/features/editor/EditorChrome.tsx'])).toEqual(['Editor']);
  expect(glassScreens(['apps/web/src/routes/signin/SignInScreen.tsx'])).toEqual(['SignIn']);
  expect(glassScreens(['apps/web/src/routes/auth.css'])).toEqual(['SignIn', 'Unmapped']);
  expect(glassScreens(['apps/web/src/routes/title/TitleScreen.tsx'])).toEqual(['Unmapped']);
  expect(glassScreens(['apps/web/src/routes/games/GameDetail.tsx'])).toEqual(['Home', 'Unmapped']);
  expect(glassScreens(['apps/web/src/components/GlassButton.tsx'])).toEqual(['Unmapped']);
  expect(glassScreens(['apps/web/public/new-image.png'])).toEqual(['Unmapped']);
  expect(glassScreens(['apps/web/src/glass-tokens.css'])).toEqual(['Unmapped']);
  expect(glassScreens(['apps/web/src/routes/games/GamesScreen.test.tsx', 'apps/web/e2e/glass-parity.spec.ts'])).toEqual(
    [],
  );
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
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual(['Home']);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('rm', 'apps/web/src/routes/games/View.tsx');
    git('commit', '-qm', 'remove screen');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual(['Home']);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await mkdir(join(root, 'apps/web/src'), { recursive: true });
    await writeFile(join(root, 'apps/web/src/glass-tokens.css'), ':root {}');
    git('add', '.');
    git('commit', '-qm', 'add tokens');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual([]);
    await mkdir(join(root, 'apps/web/src/components/glass'), { recursive: true });
    await writeFile(join(root, 'apps/web/src/components/glass/Glass.tsx'), 'export {}');
    git('add', '.');
    git('commit', '-qm', 'add library');
    expect(glassScreens(changedGlassFiles(root, 'origin/main'))).toEqual([]);
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('runs covered screens even when another screen is missing, and reports manual checks', async () => {
  const { runGlassScreens } = await import('../../tools/glass-change-selection.mjs');
  const run = vi.fn(() => true);
  const log = vi.fn();
  const error = vi.fn();
  expect(
    runGlassScreens(['apps/web/src/routes/games/GamesScreen.tsx', 'apps/web/src/routes/title/TitleScreen.tsx'], {
      run,
      log,
      error,
    }),
  ).toBe(1);
  expect(run).toHaveBeenCalledWith('Home');
  expect(error).toHaveBeenCalledOnce();
  run.mockClear();
  expect(runGlassScreens(['apps/web/src/features/editor/EditorChrome.tsx'], { run, log, error })).toBe(0);
  expect(run).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('Post-deploy check:'));
  run.mockReturnValue(false);
  expect(runGlassScreens(['apps/web/src/routes/games/GamesScreen.tsx'], { run, log, error })).toBe(1);
});
