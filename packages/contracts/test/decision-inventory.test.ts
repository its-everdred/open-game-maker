import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
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
  it('preserves a historical answered decision with a date and one option', () => {
    const historical = {
      ...entry,
      id: 'run-shape',
      mode: 'pick-one',
      options: [
        { label: 'Town, fields, goblin cave, forest, crypt; two bosses', media_needed: 'none: already decided' },
      ],
      recommendation: 'As answered',
      recommendation_reason: 'Kevin set it',
      status: 'answered',
      answer: 'Fixed order: town, wilderness, mini-dungeon, wilderness, larger dungeon.',
      answered_at: '2026-11-04',
    };
    expect(DecisionInventory.parse([historical])[0]).toEqual(historical);
  });

  it('accepts historical omitted answer fields in the published JSON Schema', () => {
    const ajv = new Ajv2020.default({ strictRequired: false });
    addFormats.default(ajv);
    const schema = JSON.parse(readFileSync(new URL('../schemas/decision-inventory.v1.json', import.meta.url), 'utf8'));
    const { answer: _answer, answered_at: _answeredAt, ...historical } = entry;
    expect(ajv.validate(schema, [historical]), JSON.stringify(ajv.errors)).toBe(true);
    const invalid = [{ ...entry, options: [] }];
    expect(DecisionInventory.safeParse(invalid).success).toBe(false);
    expect(ajv.validate(schema, invalid)).toBe(false);
  });

  it('accepts historical asked decisions awaiting media and open entries without options', () => {
    const asked = { ...entry, id: 'roll-feel', mode: 'each', status: 'asked', recommendation_reason: 'Try the roll' };
    const open = { ...entry, id: 'run-end-screen', mode: 'pick-one', options: [] };
    expect(DecisionInventory.parse([asked, open])).toEqual([asked, open]);
  });

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

  it('records what an approved round left to reuse, with at least one path', () => {
    const reuse = {
      paths: ['games/dusk/src/ui/journal-kit.ts'],
      generator: 'scripts/journal.py',
      notes: 'Nine-slice.',
    };
    expect(DecisionInventory.safeParse([{ ...entry, reuse }]).success).toBe(true);
    expect(DecisionInventory.safeParse([{ ...entry, reuse: { paths: [] } }]).success).toBe(false);
    expect(DecisionInventory.safeParse([{ ...entry, reuse: { ...reuse, url: 'x' } }]).success).toBe(false);
  });
});
