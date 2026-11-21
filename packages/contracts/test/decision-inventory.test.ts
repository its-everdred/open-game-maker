import { describe, expect, it } from 'vitest';
import { DecisionInventory } from '../src/decision-inventory.js';

const entry = {
  id: 'enemy-style',
  area: 'Enemies',
  question: 'Which enemy?',
  why: 'Sets combat tone.',
  options: [
    { label: 'Slimes', media: 'chat-1' },
    { label: 'Golems', media_needed: 'image of golem' },
  ],
  recommendation: 'Slimes: the pack has movement sheets.',
  sources: ['docs/brief.md'],
  ticket: null,
  status: 'open',
  answer: null,
  answered_at: null,
};

describe('creator decision inventory', () => {
  it('rejects duplicate ids', () => {
    expect(DecisionInventory.safeParse([entry, entry]).success).toBe(false);
  });

  it('requires media on every asked option and answer metadata on answered entries', () => {
    expect(DecisionInventory.safeParse([{ ...entry, status: 'asked' }]).success).toBe(false);
    expect(
      DecisionInventory.safeParse([{ ...entry, status: 'answered', answer: 'Slimes', answered_at: null }]).success,
    ).toBe(false);
  });

  it('accepts note-only answers and preserves note text containing colons', () => {
    const parsed = DecisionInventory.safeParse([
      {
        ...entry,
        status: 'answered',
        answer: 'Kevin: use the blue one',
        answered_at: '2026-11-21T00:00:00.000Z',
      },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('accepts only a known approval phase', () => {
    expect(DecisionInventory.safeParse([{ ...entry, phase: 'prototype' }]).success).toBe(true);
    expect(DecisionInventory.safeParse([{ ...entry, phase: 'review' }]).success).toBe(false);
  });
});
