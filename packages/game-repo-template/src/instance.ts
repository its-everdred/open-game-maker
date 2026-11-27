import { readTemplate } from './files.js';
import type { TemplateFile } from './repo.js';

export type InstanceTemplate = { files: TemplateFile[] };

const INSTANCE_FILES = [
  ['.github/pull_request_template.md', 'pull_request_template.md'],
  ['.github/workflows/ci.yml', 'instance/ci.yml'],
  ['.gitignore', 'instance/gitignore'],
  ['.npmrc', 'instance/npmrc'],
  ['README.md', 'instance/README.md'],
  ['games/README.md', 'instance/games-README.md'],
  ['package.json', 'instance/package.json'],
  ['packages/README.md', 'instance/packages-README.md'],
  ['pnpm-lock.yaml', 'instance/pnpm-lock.yaml'],
  ['pnpm-workspace.yaml', 'instance/pnpm-workspace.yaml'],
  ['tsconfig.base.json', 'instance/tsconfig.base.json'],
] as const;

export function renderInstanceTemplate(): InstanceTemplate {
  return {
    files: INSTANCE_FILES.map(([path, template]) => ({ path, content: readTemplate(template) })).sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  };
}
