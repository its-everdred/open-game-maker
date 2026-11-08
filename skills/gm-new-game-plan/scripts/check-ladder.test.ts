import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkLadder } from './check-ladder.js';

const path = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));
const TEMPLATE = readFileSync(path('../references/build-order-template.md'), 'utf8');
const BLOBS = readFileSync(path('../references/examples/blobs-ladder.md'), 'utf8');

/* #660, Kevin 2026-11-08: every game is prototyped concepts → dioramas → clips → real gameplay → iterations, with a
   creator review at each stage, so no stage is judged against a target the kit was never checked to reach. */
describe('check-ladder', () => {
  it('passes the Blobs worked example', () => {
    expect(checkLadder(BLOBS)).toEqual([]);
  });

  it('fails the template until it is filled in, so a copied blank plan never reads as ready', () => {
    const problems = checkLadder(TEMPLATE);
    expect(problems[0]).toBe('Features: fill in one row per feature (no <placeholder> or empty names)');
    expect(problems).toContain('3. Rendered gameplay clips: "<feature>" has no ticket');
    expect(problems.every((problem) => !problem.startsWith('stages must be'))).toBe(true);
  });

  it('fails a plan whose stages are out of order, so clips can never come before dioramas', () => {
    const swapped = BLOBS.replace('## 2. Dioramas', '## 2. TMP')
      .replace('## 3. Rendered gameplay clips', '## 2. Rendered gameplay clips')
      .replace('## 2. TMP', '## 3. Dioramas');
    expect(checkLadder(swapped)).toEqual([expect.stringMatching(/^stages must be, in order: 1\. Concepts → 2\. Dioramas/)]);
  });

  it('fails a plan that skips a stage', () => {
    const withoutClips = BLOBS.replace(/## 3\. Rendered gameplay clips[\s\S]*?(?=## 4\.)/, '');
    expect(checkLadder(withoutClips)).toHaveLength(1);
  });

  it('fails a stage whose review Command or roles are changed or dropped', () => {
    const vague = BLOBS.replace('Review: pick per clip (phone-ready MP4)', 'Review: TBD');
    expect(checkLadder(vague)).toEqual([
      '3. Rendered gameplay clips: Review line must read "Review: pick per clip (phone-ready MP4)"',
    ]);
    const noQa = BLOBS.replace(/(## 5\. Gameplay iterations[\s\S]*?Roles: role:gameplay), role:qa/, '$1');
    expect(checkLadder(noQa)).toEqual(['5. Gameplay iterations: Roles line must read "Roles: role:gameplay, role:qa"']);
  });

  it('fails a feature that skips a stage, since each feature climbs all five', () => {
    const skipped = BLOBS.replace(/^\| chains +\| A mid-chain still.*\n/m, '');
    expect(checkLadder(skipped)).toEqual(['2. Dioramas: no row for feature "chains"']);
  });

  it('fails a feature that is listed but in no stage, or that appears only in later stages', () => {
    const listedOnly = BLOBS.replace(/(\| round end +\| `round_end` +\|)/, '$1\n| settings | `settings` |');
    expect(checkLadder(listedOnly)).toContain('1. Concepts: no row for feature "settings"');
    const lateOnly = BLOBS.replace(
      /(## 4\. Video to real gameplay[\s\S]*?\n)(\| round end)/,
      '$1| bonus mode | x | `bonus` | 4 Slice: bonus mode, Blobs | |\n$2',
    );
    expect(checkLadder(lateOnly)).toEqual(['4. Video to real gameplay: "bonus mode" is not in Features']);
  });

  it('fails a stage row with no ticket', () => {
    const noTicket = BLOBS.replace('3 Clips: chains, Blobs', '');
    expect(checkLadder(noTicket)).toEqual(['3. Rendered gameplay clips: "chains" has no ticket']);
  });

  it('runs as a command that exits 1 with the problems, 0 when clean, 2 without a file', () => {
    const script = path('./check-ladder.ts');
    const run = (...args: string[]) => {
      try {
        return { code: 0, out: execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' }) };
      } catch (error) {
        const failed = error as { status: number; stdout: string };
        return { code: failed.status, out: failed.stdout };
      }
    };
    expect(run(path('../references/examples/blobs-ladder.md'))).toEqual({ code: 0, out: '' });
    const broken = join(mkdtempSync(join(tmpdir(), 'gm-ladder-test-')), 'ladder.md');
    writeFileSync(broken, BLOBS.replace('3 Clips: chains, Blobs', ''));
    expect(run(broken)).toEqual({ code: 1, out: '3. Rendered gameplay clips: "chains" has no ticket\n' });
    expect(run().code).toBe(2);
  });
});
