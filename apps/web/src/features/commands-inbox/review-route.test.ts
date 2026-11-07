import { describe, expect, it } from 'vitest';

import type { GameCommand } from '@ogm/contracts';

import { findCommand, reviewPath } from './review-route';

function command(overrides: Partial<GameCommand> = {}): GameCommand {
  return {
    job_id: 'j_1',
    ticket: '570',
    title: 'Pick the voices',
    checkpoint_id: 'cp_1',
    decision_id: 'd_1',
    version: 2,
    question: 'Which voice should the Blobs use?',
    options: [
      { id: 'v1', label: 'Voice one', media: { url: 'https://media.example.test/v1.wav', width: 1, height: 1 } },
      { id: 'v2', label: 'Voice two', media: { url: 'https://media.example.test/v2.wav', width: 1, height: 1 } },
    ],
    blocking: true,
    opened_at: '2026-11-07T17:40:00.000Z',
    ...overrides,
  };
}

describe('review deep link', () => {
  // The ticket's link shape: one URL per Command so the Executor can push it to the creator's phone.
  it('builds /game/<gameId>/review/<checkpointId>', () => {
    expect(reviewPath('g_1', command())).toBe('/game/g_1/review/cp_1');
  });

  it('escapes a game id so the path stays one segment', () => {
    expect(reviewPath('g/../1', command())).toBe('/game/g%2F..%2F1/review/cp_1');
  });

  // A link built from either identifier resolves to the same Command, so a decision id from aiur's side lands too.
  it('finds the Command by its checkpoint id or its decision id', () => {
    const commands = [command()];
    expect(findCommand(commands, 'cp_1')).toBe(commands[0]);
    expect(findCommand(commands, 'd_1')).toBe(commands[0]);
    expect(findCommand(commands, 'cp_missing')).toBeUndefined();
  });
});
