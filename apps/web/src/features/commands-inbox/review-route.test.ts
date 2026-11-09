import { describe, expect, it } from 'vitest';

import type { GameCommand } from '@ogm/contracts';

import { findCommand, findCommandByNumber, reviewPath } from './review-route';

function command(overrides: Partial<GameCommand> = {}): GameCommand {
  return {
    job_id: 'j_1',
    ticket: '570',
    title: 'Pick the voices',
    command_id: 'cp_1',
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
  // The short link (#591): the game's slug and the Command's number, short enough to read out or type on a phone.
  it('builds /<slug>/review/<n>', () => {
    expect(reviewPath('blobs', 12)).toBe('/blobs/review/12');
  });

  it('escapes a slug so the path stays one segment', () => {
    expect(reviewPath('b/../1', 3)).toBe('/b%2F..%2F1/review/3');
  });

  it('finds the Command by its short number', () => {
    const commands = [
      command({ decision_id: 'd_1', review_number: 1 }),
      command({ decision_id: 'd_2', review_number: 2 }),
    ];
    expect(findCommandByNumber(commands, '2')).toBe(commands[1]);
    expect(findCommandByNumber(commands, '3')).toBeUndefined();
    expect(findCommandByNumber([command()], 'undefined')).toBeUndefined();
  });

  // A link built from either identifier resolves to the same Command, so a decision id from aiur's side lands too.
  it('finds the Command by its command id or its decision id', () => {
    const commands = [command()];
    expect(findCommand(commands, 'cp_1')).toBe(commands[0]);
    expect(findCommand(commands, 'd_1')).toBe(commands[0]);
    expect(findCommand(commands, 'cp_missing')).toBeUndefined();
  });
});
