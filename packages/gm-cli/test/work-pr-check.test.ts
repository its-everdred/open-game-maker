import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { command } from '../src/commands/work/pr-check.js';
import type { GmContext } from '../src/command.js';
import { tempDir } from './helpers.js';

it('fails a same-feature overlap until the body names the PR it extends', async () => {
  const root = tempDir('gm-pr-check-');
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
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\ncase "$2$3" in\n  *issues/10/comments*) printf '%s\\n' '{"body":"**Overlap review**\\n\\nBefore dispatch for #10: Extend existing open PR #33.","author_association":"OWNER","created_at":"2026-11-26T00:00:00Z"}' ;;\n  *issues/10*) echo '{"number":10,"labels":[{"name":"feature:combat"}]}' ;;\n  *issues?*) echo '{"number":10,"labels":[]}'; echo '{"number":11,"labels":[]}' ;;\n  *pulls/22/files*) echo '"src/combat.ts"' ;;\n  *pulls/22) echo '{"changed_files":1}' ;;\n  *pulls?*) echo '{"number":22,"state":"open","body":"Closes #11","head":{"ref":"aiur/11"}}' ;;\n  *) exit 1 ;;\nesac\n`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const errors: string[] = [];
  const ctx = {
    cwd: root,
    env: { PATH: `${bin}:${process.env.PATH}` },
    json: false,
    err: (line: string) => errors.push(line),
    out() {},
  } as GmContext;
  const body = 'Closes #10\n\n## Related work\nReused: none\nOverlap: none\nVerdict: build\n';
  writeFileSync(join(root, 'pr.md'), body);
  expect(await command.run(ctx, [], { body: 'pr.md', base: 'origin/main', pr: 99 })).toBe(1);
  expect(errors.join('\n')).toContain('overlapping PR #22');
  expect(errors.join('\n')).toContain("overlap review's target #33");
  errors.length = 0;
  writeFileSync(join(root, 'pr.md'), body.replace('Overlap: none', 'Overlap: extends #22 and extends #33'));
  expect(await command.run(ctx, [], { body: 'pr.md', base: 'origin/main', pr: 99 })).toBe(0);
  const complete = readFileSync(join(bin, 'gh'), 'utf8');
  writeFileSync(join(bin, 'gh'), complete.replace('"changed_files":1', '"changed_files":2'));
  await expect(command.run(ctx, [], { body: 'pr.md', base: 'origin/main', pr: 99 })).rejects.toThrow(
    'expected 2, received 1',
  );
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho \'{"number":10,"labels":[]}\'\n');
  errors.length = 0;
  expect(await command.run(ctx, [], { body: 'pr.md', base: 'origin/main', pr: 99 })).toBe(1);
  expect(errors.join('\n')).toContain('No feature label is projected');
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "GitHub unavailable" >&2\nexit 1\n');
  await expect(command.run(ctx, [], { body: 'pr.md', base: 'origin/main', pr: 99 })).rejects.toThrow(
    'gh failed: GitHub unavailable',
  );
});

it('exempts a documentation-only PR without reading GitHub', async () => {
  const root = tempDir('gm-pr-docs-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args]);
  git('init', '-q');
  writeFileSync(join(root, 'README.md'), 'base');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(join(root, 'README.md'), 'docs change');
  git('add', '-A');
  git('commit', '-qm', 'docs');
  writeFileSync(join(root, 'pr.md'), '');
  const ctx = { cwd: root, env: { PATH: process.env.PATH }, json: false, err() {}, out() {} } as GmContext;
  expect(await command.run(ctx, [], { body: 'pr.md', base: 'origin/main', pr: 99 })).toBe(0);
});
