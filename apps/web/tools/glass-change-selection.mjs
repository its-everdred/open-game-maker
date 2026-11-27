import { execFileSync } from 'node:child_process';

export function changedGlassFiles(root, base = 'origin/main') {
  const fields = execFileSync(
    'git',
    [
      'diff',
      '--name-status',
      '-z',
      '--no-renames',
      '--diff-filter=ACMRD',
      `${base}...HEAD`,
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
    // The initial generated file is not yet imported; later edits affect the design system.
    if (status === 'A' && file === 'apps/web/src/glass-tokens.css') continue;
    files.push(file);
  }
  return files;
}

/** Screens whose owned routes or UI changed. Unsupported screens fail closed in CI. */
export function glassScreens(files) {
  const screens = new Set();
  for (const file of files) {
    if (/\.(?:test|spec)\.[^.]+$/.test(file)) continue;
    if (file.startsWith('apps/web/src/routes/games/')) {
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
