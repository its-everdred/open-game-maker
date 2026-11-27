import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fill, isExecutable, readTemplate, WORKSPACE_ROOT } from './files.js';
import { LABELS, type TemplateLabel } from './labels.js';

export type FileMode = '100644' | '100755' | '120000';
// A `120000` entry is a symlink whose content is its relative target.
export type TemplateFile = { path: string; content: string; mode?: FileMode };
export type RepoTemplate = { files: TemplateFile[]; labels: TemplateLabel[]; requiredChecks: string[] };
export type TemplateCtx = { gameId: string; owner: string; visibility: 'public' | 'private' };
export type Engine = '2d' | '3d' | 'multiplayer';

export const REQUIRED_CHECKS = ['ci / required', 'ogm/boundary'] as const;
const REF = /^game-(2d|3d|multiplayer)@1$/;

export function parseTemplateRef(ref: string): Engine {
  const match = REF.exec(ref);
  if (!match) throw new Error(`unknown template ref: ${ref}`);
  return match[1] as Engine;
}

export function renderRepoTemplate(ref: string, ctx: TemplateCtx, root: string = WORKSPACE_ROOT): RepoTemplate {
  const engine = parseTemplateRef(ref);
  const values = { gameId: ctx.gameId };
  const scaffoldFiles = scaffold(engine, root, values);
  const scaffoldPaths = new Set(scaffoldFiles.map((file) => file.path));

  const files: TemplateFile[] = [
    ...(!scaffoldPaths.has('.github/pull_request_template.md')
      ? [{ path: '.github/pull_request_template.md', content: readTemplate('pull_request_template.md') }]
      : []),
    { path: '.github/workflows/ci.yml', content: readTemplate('ci.yml') },
    { path: 'AGENTS.md', content: fill(readTemplate('AGENTS.md'), values) },
    ...(!scaffoldPaths.has('README.md')
      ? [{ path: 'README.md', content: fill(readTemplate('README.md'), values) }]
      : []),
    { path: '.gitignore', content: readTemplate('gitignore') },
    ...scaffoldFiles,
  ];

  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) throw new Error(`template renders ${file.path} twice`);
    seen.add(file.path);
  }
  return {
    files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    labels: LABELS.map((label) => ({ ...label })),
    requiredChecks: [...REQUIRED_CHECKS],
  };
}

// `templates/game-<engine>/` from the workspace when OGM-023/024/055 have landed, else a `gm new`-shaped placeholder.
function scaffold(engine: Engine, root: string, values: Record<string, string>): TemplateFile[] {
  const dir = join(root, 'templates', `game-${engine}`);
  const paths = existsSync(dir)
    ? execFileSync('git', ['ls-files', '-z', '--cached', '--', '.'], { cwd: dir })
        .toString()
        .split('\0')
        .filter(Boolean)
        .sort()
    : [];
  if (paths.length > 0) {
    return paths.map((path) => ({
      path,
      content: readFileSync(join(dir, path), 'utf8'),
      ...(isExecutable(join(dir, path)) ? { mode: '100755' as const } : {}),
    }));
  }
  return [
    { path: 'package.json', content: fill(readTemplate('scaffold-package.json'), values) },
    { path: 'pnpm-lock.yaml', content: readTemplate('scaffold-pnpm-lock.yaml') },
    { path: '.npmrc', content: readTemplate('npmrc') },
  ];
}
