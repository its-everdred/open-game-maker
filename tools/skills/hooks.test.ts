import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('repository Git hooks', () => {
  it('formats staged files and stages the formatted content', () => {
    execFileSync('node', ['.githooks/test-pre-commit.mjs'], { cwd: root, stdio: 'inherit' });
  });

  it('installs the executable hook during pnpm install', () => {
    execFileSync('node', ['.githooks/test-install.mjs'], { cwd: root, stdio: 'inherit' });
  });
});
