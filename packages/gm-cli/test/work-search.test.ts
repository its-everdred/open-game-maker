import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { tempDir } from './helpers.js';
import { command } from '../src/commands/work/search.js';
import { matchesWorkTicket } from '../src/work-io.js';
import type { GmContext } from '../src/command.js';

it('matches local ticket references without confusing another repository for this one', () => {
  const members = new Set([12]);
  expect(matchesWorkTicket('Refs other/repo#12', 'unrelated', members)).toBe(false);
  expect(matchesWorkTicket('Refs #12', 'unrelated', members)).toBe(true);
  expect(matchesWorkTicket('', 'aiur/12-attack', members)).toBe(true);
});

it('finds in-flight feature work, its files and decisions', async () => {
  const root = tempDir('gm-work-');
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', root]);
  mkdirSync(join(root, 'docs', 'dusk'), { recursive: true });
  writeFileSync(
    join(root, 'docs', 'dusk', 'decisions.json'),
    JSON.stringify([{ id: 'combat-style', answer: 'swords' }]),
  );
  mkdirSync(join(root, 'src', 'combat'), { recursive: true });
  writeFileSync(join(root, 'src', 'combat', 'attack.ts'), '');
  execFileSync('git', ['-C', root, 'add', 'src/combat/attack.ts']);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const aiur = join(bin, 'aiur-main');
  writeFileSync(
    aiur,
    `#!/bin/sh\nif [ "$3" = "--json" ]; then\n  echo '{"features":[{"key":"combat","label":"Combat"}]}'\nelse\n  echo '{"feature":{"key":"combat","label":"Combat"},"members":[{"id":12,"epic":"animation"}],"also":[]}'\nfi\n`,
  );
  chmodSync(aiur, 0o755);
  const gh = join(bin, 'gh');
  writeFileSync(
    gh,
    `#!/bin/sh\ncase "$2$3" in\n  *issues*) echo '{"number":12,"title":"Animate attack","state":"open","body":"Combat","updated_at":"2026-11-01"}' ;;\n  *pulls/22/files*) echo '"src/attack.ts"' ;;\n  *pulls/22) echo '{"changed_files":1}' ;;\n  *pulls*) echo '{"number":22,"title":"Attack","state":"open","body":"Refs #12","head":{"ref":"aiur/12-attack"},"updated_at":"2026-11-01","merged_at":null}' ;;\n  *) exit 1 ;;\nesac\n`,
  );
  chmodSync(gh, 0o755);
  const output: string[] = [];
  const context = {
    cwd: root,
    env: { PATH: `${bin}:${process.env.PATH}` },
    assetsRoot: null,
    json: true,
    limit: 10,
    out: (line: string) => output.push(line),
  } as GmContext;
  expect(await command.run(context, ['combat'], {})).toBe(0);
  const report = JSON.parse(output[0]!);
  expect(report.issues.map((issue: { number: number }) => issue.number)).toEqual([12]);
  expect(report.pulls[0].files).toEqual(['src/attack.ts']);
  expect(report.decisions[0].decision.id).toBe('combat-style');
  expect(report.paths).toContain('src/combat/attack.ts');
  expect(report.limitations).toContain('Asset catalog unavailable.');
  output.length = 0;
  expect(await command.run(context, ['attack'], {})).toBe(0);
  expect(JSON.parse(output[0]!).features[0].feature.key).toBe('combat');
});
