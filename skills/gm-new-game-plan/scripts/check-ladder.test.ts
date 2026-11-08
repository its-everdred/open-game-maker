import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkLadder } from './check-ladder.js';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const TEMPLATE = read('../references/build-order-template.md');
const BLOBS = read('../references/examples/blobs-ladder.md');

/* #660, Kevin 2026-11-08: every game is prototyped concepts → dioramas → clips → real gameplay → iterations, with a
   creator review at each stage, so no stage is judged against a target the kit was never checked to reach. */
describe('check-ladder', () => {
  it("passes the template every new game's plan starts from and the Blobs worked example", () => {
    expect(checkLadder(TEMPLATE)).toEqual([]);
    expect(checkLadder(BLOBS)).toEqual([]);
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

  it('fails a stage with no review Command or a missing role', () => {
    const noReview = BLOBS.replace('Review: pick per clip (phone-ready MP4)\n', '');
    expect(checkLadder(noReview)).toEqual(['3. Rendered gameplay clips: no "Review:" line']);
    const noQa = BLOBS.replace('Roles: role:gameplay, role:qa\n\n| Feature | Knob', 'Roles: role:gameplay\n\n| Feature | Knob');
    expect(checkLadder(noQa)).toEqual(['5. Gameplay iterations: missing role:qa']);
  });

  it('fails a feature that skips a stage, since each feature climbs all five', () => {
    const skipped = BLOBS.replace(/^\| chains \| A mid-chain still.*\n/m, '');
    expect(checkLadder(skipped)).toEqual(['2. Dioramas: no row for feature "chains"']);
  });
});
