import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { gm, tempDir } from './helpers.js';

describe('gm look judge', () => {
  it('uses the broker response and gates later tiers', async () => {
    const cwd = tempDir('gm-judge-');
    execFileSync('git', ['init', '-q', cwd]);
    const pack = join(cwd, '.claude/skills');
    const dir = join(pack, 'gm-image-mock/scripts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'request-mock.py'),
      `import os, sys\nout = sys.argv[sys.argv.index('--out') + 1]\nos.makedirs(out, exist_ok=True)\np = os.path.join(out, 'answer.txt')\nopen(p, 'w').write('{"tiers":[6,9,9,9],"differences":["Shape is too wide"]}\\nVERDICT: fail')\nprint(p)\n`,
    );
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toFile(join(cwd, 'a.png'));
    const scored = await gm(['look', 'score', 'a.png', 'a.png'], { cwd });
    expect(scored.code).toBe(0);
    const result = await gm(['look', 'judge', 'look-score.png', '--rubric', 'tiers'], {
      cwd,
      env: { GM_SKILLS_DIR: pack },
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!)).toMatchObject({
      tiers: [6, null, null, null],
      verdict: 'revise',
      differences: ['Shape is too wide'],
    });
    writeFileSync(join(cwd, 'a.png'), 'changed');
    const changed = await gm(['look', 'judge', 'look-score.png', '--rubric', 'tiers'], {
      cwd,
      env: { GM_SKILLS_DIR: pack },
    });
    expect(changed.code).toBe(1);
    expect(changed.err.join()).toContain('source changed');
  });
});
