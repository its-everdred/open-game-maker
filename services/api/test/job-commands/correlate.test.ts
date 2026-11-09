import type { Decision } from '@ogm/aiur-client';
import { describe, expect, it } from 'vitest';

import { commandMarker, isForCreator } from '../../src/job-commands/correlate.js';

const CP_ID = 'cp_01JBX2R1A2B3C4D5E6F7G8H9JK';

function decision(markdown: string): Decision {
  return { decision_id: 'd_1', question: 'Which door?', context: { long_context_markdown: markdown } } as Decision;
}

// #571 renamed the marker `gm command request` writes. Commands raised before the upgrade are still open in aiur with
// the old marker; they must keep reaching the creator and their build chat card.
describe('command marker', () => {
  it('reads the marker gm command request writes', () => {
    expect(commandMarker(decision(`<!-- gm-command:${CP_ID} -->`))).toBe(CP_ID);
  });

  it('still reads the marker a Command raised before the rename carries', () => {
    const before = decision(`<!-- gm-checkpoint:${CP_ID} -->`);
    expect(commandMarker(before)).toBe(CP_ID);
    expect(isForCreator(before)).toBe(true);
  });
});
