import { describe, expect, it } from 'vitest';

import { budgetReport } from '../src/commands/build/assets/budget.js';

// A game with a full scene (characters, clips, sounds, scenery) needs more than 30 small files;
// the byte cap, not the count, keeps a mobile download small.
function game(count: number) {
  const assets: Record<string, { file: Record<string, string> }> = {};
  const details: Record<string, { bytes: number }> = {};
  for (let i = 0; i < count; i++) {
    assets[`a${i}`] = { file: { '*': `f${i}.bin` } };
    details[`f${i}.bin`] = { bytes: 10_000 };
  }
  return { manifest: { assets } as never, details: details as never };
}

describe('mobile file-count budget', () => {
  it('lets a 31-file game with a scenery bundle pass', () => {
    const { manifest, details } = game(31);
    expect(budgetReport(manifest, details, 'mobile' as never).exceeded).toEqual([]);
  });

  it('still flags a game past 48 files', () => {
    const { manifest, details } = game(49);
    expect(budgetReport(manifest, details, 'mobile' as never).exceeded).toEqual([
      { metric: 'files', value: 49, limit: 48 },
    ]);
  });
});
