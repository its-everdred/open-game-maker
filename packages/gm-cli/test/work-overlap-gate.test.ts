import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { checkPrReview } from '../src/pr-review-check.js';
import { tempDir } from './helpers.js';

it('rejects a shared file unless related work says which PR it extends', () => {
  const root = tempDir('gm-overlap-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args]);
  git('init', '-q');
  writeFileSync(join(root, 'README.md'), 'base');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'combat.ts'), 'export {};');
  git('add', '-A');
  git('commit', '-qm', 'combat');
  writeFileSync(
    join(root, 'work.json'),
    JSON.stringify({ pulls: [{ number: 12, state: 'open', files: ['src/combat.ts'] }] }),
  );
  const body =
    'Prototype review: none (no player-visible change)\n\n## Related work\nReused: none\nOverlap: none\nVerdict: build\n';
  writeFileSync(join(root, 'pr.md'), body);
  expect(checkPrReview(root, 'pr.md', 'origin/main', 'work.json').join('\n')).toContain('overlapping PR #12');
  writeFileSync(join(root, 'pr.md'), body.replace('Overlap: none', 'Overlap: extends #12'));
  expect(checkPrReview(root, 'pr.md', 'origin/main', 'work.json').join('\n')).not.toContain('overlapping PR #12');
});
