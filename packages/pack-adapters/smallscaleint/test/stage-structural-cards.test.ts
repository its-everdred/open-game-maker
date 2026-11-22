import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import { structuralImageBounds } from '../src/structural-bounds.js';

it('stages validated card copies without changing the library and refuses unsafe output', () => {
  const temp = mkdtempSync(join(tmpdir(), 'structural-cards-'));
  const library = join(temp, 'library');
  const output = join(temp, 'staged');
  const script = fileURLToPath(new URL('../scripts/stage-structural-cards.mjs', import.meta.url));
  try {
    for (const id of Object.keys(structuralImageBounds.value)) {
      const [, pack, group, slug] = /^t1:([^/]+)\/tiles\/([^/]+)\/([^@]+)@/.exec(id)!;
      const file = join(library, 'packs', pack!, 'cards', 'tiles', group!, `${slug}.card.json`);
      mkdirSync(dirname(file), { recursive: true });
      const fixture = JSON.parse(
        readFileSync(
          new URL('../../../contracts/fixtures/cards/sprite-kenney-tiny-dungeon-knight.json', import.meta.url),
          'utf8',
        ),
      );
      fixture.id = id;
      writeFileSync(file, JSON.stringify(fixture));
    }
    execFileSync(process.execPath, [script, library, output]);
    const plan = JSON.parse(readFileSync(join(output, 'plan.json'), 'utf8')) as {
      source: string;
      sha256: string;
      staged: string;
    }[];
    expect(plan).toHaveLength(Object.keys(structuralImageBounds.value).length);
    const source = readFileSync(join(library, plan[0]!.source));
    expect(createHash('sha256').update(source).digest('hex')).toBe(plan[0]!.sha256);
    expect(JSON.parse(source.toString()).sprite.structural_facings).toBeUndefined();
    expect(JSON.parse(readFileSync(join(output, plan[0]!.staged), 'utf8')).sprite.structural_facings).toBeDefined();
    expect(() =>
      execFileSync(process.execPath, [script, library, join(library, 'unsafe')], { stdio: 'pipe' }),
    ).toThrow();
    expect(existsSync(join(library, 'unsafe'))).toBe(false);
    expect(() => execFileSync(process.execPath, [script, library, output], { stdio: 'pipe' })).toThrow();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}, 90_000);
