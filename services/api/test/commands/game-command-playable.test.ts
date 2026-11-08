import type { Decision } from '@ogm/aiur-client';
import { playableMarker, type OptionPlayable } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { toGameCommand } from '../../src/commands/aiur.js';

// Blobs playtests (open-games #204, #639) are raised with `gm checkpoint open --playable` from an aiur workspace or the
// host, with no build job. aiur keeps only text on the options, so the slices travel in the context's playable marker,
// and the game's deck reads the Command from aiur: without the marker read back, Kevin gets text cards he cannot play.
const slow: OptionPlayable = { scenario: 'scenario=sandbox&speed=slow', seconds: 20 };
const fast: OptionPlayable = { scenario: 'scenario=sandbox&speed=fast', seconds: 20, lead_in: 'one-chain' };

const decision = (longContext: string): Decision => ({
  decision_id: 'd_playtest_2',
  version: 1,
  ticket: { identifier: '204' },
  kind: 'direction_checkpoint',
  authority: 'supervisor_allowed',
  blocking: false,
  reversibility: 'reversible',
  question: 'Which fall speed feels right?',
  options: [
    { id: 'a', label: 'Slow', description: 'Play Slow for 20s' },
    { id: 'b', label: 'Fast', description: 'Play Fast for 20s' },
    { id: 'c', label: 'Neither' },
  ],
  context: { short_summary: 'Fall speed', long_context_markdown: longContext },
  answer: null,
  active_answer: null,
  created_at: '2026-11-08T18:00:00.000Z',
  decision_status: 'open',
});

describe('a registered game’s playable Command', () => {
  it('gives each option its slice from the context marker', () => {
    const marker = playableMarker(
      new Map([
        ['a', slow],
        ['b', fast],
      ]),
    );
    const command = toGameCommand(
      decision(`<!-- gm-checkpoint:cp_01JBX2Q7M3K8V5N4R6T9W0YZAB -->\nPlay them.\n${marker}`),
    );

    expect(command?.options).toEqual([
      { id: 'a', label: 'Slow', playable: slow },
      { id: 'b', label: 'Fast', playable: fast },
      { id: 'c', label: 'Neither' },
    ]);
  });

  it('keeps the Command as text cards when the marker is malformed or names an unsafe scenario', () => {
    for (const context of [
      '<!-- gm-playable:{not json} -->',
      `<!-- gm-playable:${JSON.stringify({ a: { scenario: 'next=https://example.test/', seconds: 8 } })} -->`,
    ]) {
      const command = toGameCommand(decision(context));
      expect(command?.options.map(({ playable }) => playable)).toEqual([undefined, undefined, undefined]);
    }
  });
});
