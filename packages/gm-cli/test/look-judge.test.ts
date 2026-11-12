import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { gm, tempDir } from './helpers.js';

describe('gm look judge', () => {
  it('reports medians and spread across three broker runs', async () => {
    const cwd = tempDir('gm-judge-median-');
    execFileSync('git', ['init', '-q', cwd]);
    const pack = join(cwd, '.claude/skills');
    const dir = join(pack, 'gm-image-mock/scripts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'request-mock.py'),
      `import json, os, sys
out = sys.argv[sys.argv.index('--out') + 1]
counter = os.path.join(out, 'counter')
n = int(open(counter).read()) if os.path.exists(counter) else 0
open(counter, 'w').write(str(n + 1))
p = os.path.join(out, 'answer.txt')
open(p, 'w').write(json.dumps({'tiers': [[6, 8, 8, 8], [8, 9, 9, 9], [7, 10, 10, 10]][n], 'differences': []}))
print(p)
`,
    );
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toFile(join(cwd, 'a.png'));
    expect((await gm(['look', 'score', 'a.png', 'a.png'], { cwd })).code).toBe(0);
    const result = await gm(['look', 'judge', 'look-score.png', '--rubric', 'tiers'], {
      cwd,
      env: { GM_SKILLS_DIR: pack },
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!)).toMatchObject({ tiers: [7, 9, 9, 9], spread: [1, 1, 1, 1] });
    const again = await gm(['look', 'judge', 'look-score.png', '--rubric', 'tiers'], {
      cwd,
      env: { GM_SKILLS_DIR: pack },
    });
    expect(again.out).toEqual(result.out);
  });

  it('reports spreads covering the median difference for near-identical captures', async () => {
    const cwd = tempDir('gm-judge-near-');
    execFileSync('git', ['init', '-q', cwd]);
    const pack = join(cwd, '.claude/skills');
    const dir = join(pack, 'gm-image-mock/scripts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'request-mock.py'),
      `import json, os, sys
out = sys.argv[sys.argv.index('--out') + 1]
counter = os.path.join(out, 'counter')
n = int(open(counter).read()) if os.path.exists(counter) else 0
open(counter, 'w').write(str(n + 1))
p = os.path.join(out, 'answer.txt')
value = [7, 8, 9, 8, 9, 10][n]
open(p, 'w').write(json.dumps({'tiers': [value] * 4, 'differences': []}))
print(p)
`,
    );
    const pixels = Buffer.alloc(8 * 8 * 3, 100);
    await sharp(pixels, { raw: { width: 8, height: 8, channels: 3 } })
      .png()
      .toFile(join(cwd, 'a.png'));
    pixels[0] = 101;
    await sharp(pixels, { raw: { width: 8, height: 8, channels: 3 } })
      .png()
      .toFile(join(cwd, 'b.png'));
    const judge = async (candidate: string) => {
      expect((await gm(['look', 'score', 'a.png', candidate], { cwd })).code).toBe(0);
      const result = await gm(['look', 'judge', 'look-score.png', '--rubric', 'tiers'], {
        cwd,
        env: { GM_SKILLS_DIR: pack },
      });
      expect(result.code).toBe(0);
      return JSON.parse(result.out[0]!) as { tiers: number[]; spread: number[] };
    };
    const first = await judge('a.png');
    const second = await judge('b.png');
    for (let i = 0; i < 4; i++)
      expect(Math.abs(first.tiers[i]! - second.tiers[i]!)).toBeLessThanOrEqual(
        Math.max(first.spread[i]!, second.spread[i]!),
      );
  });

  it('returns one cached verdict for concurrent judgments', async () => {
    const cwd = tempDir('gm-judge-race-');
    execFileSync('git', ['init', '-q', cwd]);
    const pack = join(cwd, '.claude/skills');
    const dir = join(pack, 'gm-image-mock/scripts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'request-mock.py'),
      `import json, os, sys, time
out = sys.argv[sys.argv.index('--out') + 1]
time.sleep(0.3)
p = os.path.join(out, str(os.getpid()) + '.txt')
n = 7 if os.getpid() % 2 else 9
open(p, 'w').write(json.dumps({'tiers': [n] * 4, 'differences': [str(os.getpid())]}))
print(p)
`,
    );
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toFile(join(cwd, 'a.png'));
    expect((await gm(['look', 'score', 'a.png', 'a.png'], { cwd })).code).toBe(0);
    const args = ['look', 'judge', 'look-score.png', '--rubric', 'tiers', '--runs', '1'];
    const [first, second] = await Promise.all([
      gm(args, { cwd, env: { GM_SKILLS_DIR: pack } }),
      gm(args, { cwd, env: { GM_SKILLS_DIR: pack } }),
    ]);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(first.out).toEqual(second.out);
  });

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
    const repeated = await gm(['look', 'judge', 'look-score.png', '--rubric', 'tiers'], {
      cwd,
      env: { GM_SKILLS_DIR: pack },
    });
    expect(repeated.out).toEqual(result.out);
    const rescored = await gm(['look', 'score', 'a.png', 'a.png'], { cwd });
    expect(JSON.parse(rescored.out[0]!).judge_spread).toEqual([0, null, null, null]);
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const manifestPath = join(cwd, 'look-score.png.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const unrelated = await sharp({ create: { width: 32, height: 8, channels: 3, background: 'blue' } })
      .png()
      .toBuffer();
    writeFileSync(join(cwd, 'look-score.png'), unrelated);
    manifest.hashes[2] = createHash('sha256').update(unrelated).digest('hex');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const forged = await gm(['look', 'judge', 'look-score.png', '--rubric', 'tiers'], { cwd });
    expect(forged.code).toBe(1);
    expect(forged.err.join()).toContain('sheet does not match its sources');
    await gm(['look', 'score', 'a.png', 'a.png'], { cwd });
    writeFileSync(join(cwd, 'a.png'), 'changed');
    const changed = await gm(['look', 'judge', 'look-score.png', '--rubric', 'tiers'], {
      cwd,
      env: { GM_SKILLS_DIR: pack },
    });
    expect(changed.code).toBe(1);
    expect(changed.err.join()).toContain('source changed');
  });
});

it(
  'sends all score sources through the real look request and handles broker answers',
  { timeout: 30_000 },
  async () => {
    const { copyFileSync, existsSync, readdirSync, readFileSync, symlinkSync, unlinkSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { setTimeout: sleep } = await import('node:timers/promises');
    const cwd = tempDir('gm-judge-protocol-');
    execFileSync('git', ['init', '-q', cwd]);
    const dir = join(cwd, '.claude/skills/gm-image-mock/scripts');
    mkdirSync(dir, { recursive: true });
    copyFileSync(
      fileURLToPath(new URL('../../../skills/gm-image-mock/scripts/request-mock.py', import.meta.url)),
      join(dir, 'request-mock.py'),
    );
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toFile(join(cwd, 'a.png'));
    copyFileSync(join(cwd, 'a.png'), join(cwd, 'b.png'));
    symlinkSync('a.png', join(cwd, 'alias.png'));
    expect((await gm(['look', 'score', 'alias.png', 'a.png'], { cwd })).code).toBe(0);
    unlinkSync(join(cwd, 'alias.png'));
    symlinkSync('b.png', join(cwd, 'alias.png'));
    async function request(answer: string | null) {
      mkdirSync(join(cwd, '.gm-mock/judge'), { recursive: true });
      for (const name of readdirSync(join(cwd, '.gm-mock/judge')).filter((n) => n.startsWith('verdict-')))
        unlinkSync(join(cwd, '.gm-mock/judge', name));
      const promise = gm(['look', 'judge', 'look-score.png', '--rubric', 'tiers', '--runs', '1'], { cwd });
      const requests = join(cwd, '.gm-mock/requests');
      let name: string | undefined;
      for (let i = 0; i < 200 && !name; i++) {
        if (existsSync(requests)) name = readdirSync(requests).find((n) => n.endsWith('.json'));
        if (!name) await sleep(20);
      }
      if (!name) throw new Error('no broker request');
      const file = join(requests, name);
      const req = JSON.parse(readFileSync(file, 'utf8')) as { id: string; refs: string[]; out: string };
      unlinkSync(file);
      expect(req.refs.slice(0, 2)).toEqual(['a.png', 'a.png']);
      expect(req.refs[2]).toMatch(/^\.gm-mock\/judge\/.+\.png$/);
      const originalSheet = readFileSync(join(cwd, 'look-score.png'));
      writeFileSync(join(cwd, 'look-score.png'), 'replacement');
      expect(readFileSync(join(cwd, req.refs[2]!))).toEqual(originalSheet);
      writeFileSync(join(cwd, 'look-score.png'), originalSheet);
      const done = join(cwd, '.gm-mock/done', `${req.id}.json`);
      if (answer === null) writeFileSync(done, JSON.stringify({ ok: false, error: 'ref refused' }));
      else {
        writeFileSync(join(cwd, req.out, `${req.id}.look.md`), answer);
        writeFileSync(done, JSON.stringify({ ok: true, file: `${req.id}.look.md` }));
      }
      return promise;
    }
    const passed = await request('{"tiers":[8,9,8,10],"differences":[]}\nVERDICT: pass');
    expect(passed.code).toBe(0);
    expect(JSON.parse(passed.out[0]!).verdict).toBe('pass');
    const malformed = await request('not JSON\nVERDICT: pass');
    expect(malformed.code).toBe(1);
    const refused = await request(null);
    expect(refused.code).toBe(1);
    expect(refused.err.join()).toContain('ref refused');
    expect(existsSync(join(cwd, '.gm-mock/looks.jsonl'))).toBe(false);
  },
);
