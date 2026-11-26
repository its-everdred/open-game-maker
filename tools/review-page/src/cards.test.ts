import { describe, expect, it } from 'vitest';
import { commandCard, type Media } from './cards.js';
import { filesDelta } from './bundle.js';

const image = (src: string): Media => ({ kind: 'img', src });
const resolve = (items: unknown[]) => items.map((item) => image(String(item)));

describe('review cards', () => {
  it('renders a matrix with originals first in each row', () => {
    const options = ['Hero / V1', 'Hero / Original', 'Mage / V1', 'Mage / Original'].map((label, index) => ({
      id: String(index),
      label,
      media: [label],
    }));
    const card = commandCard(
      'core',
      { decision_id: 'dec_1', question: 'Compare', created_at: '', ticket: { identifier: 4 }, options },
      resolve,
    );
    expect(card.mode).toBe('matrix');
    expect(card.rows?.map((row) => row.cells.map((cell) => cell.orig))).toEqual([
      [true, false],
      [true, false],
    ]);
  });
  it('maps one image per choice into independent verdict groups', () => {
    const card = commandCard(
      'core',
      {
        decision_id: 'dec_123',
        question: 'Pick a look',
        created_at: '2026-11-26T00:00:00Z',
        ticket: { identifier: '12' },
        media: ['a', 'b', 'c'],
        options: ['A', 'B', 'C'].map((label) => ({ id: label.toLowerCase(), label })),
      },
      resolve,
    );
    expect(card.mode).toBe('multi');
    expect(card.groups?.map((group) => group.media[0]?.src)).toEqual(['a', 'b', 'c']);
    expect(card.groups?.[0]?.options.map((option) => option.id)).toEqual(['like', 'dislike']);
    expect(card.shared).toEqual([]);
  });
  it('keeps shared media with simple review options', () => {
    const card = commandCard(
      'core',
      {
        decision_id: 'dec_1',
        question: 'Ready?',
        created_at: '2026-11-26T00:00:00Z',
        ticket: { identifier: 5 },
        media: ['preview'],
        options: [{ id: 'yes', label: 'Yes' }],
      },
      resolve,
    );
    expect(card.mode).toBe('review');
    expect(card.shared).toEqual([image('preview')]);
    expect(card.options[0]?.label).toBe('Yes');
  });
});

describe('publish delta', () => {
  it('uploads only changed files and deletes enough stale files for the cap', () => {
    expect(filesDelta({ 'm/a': 'same', 'm/c': 'new' }, { 'm/a': 'same', 'm/b': 'old' }, 2)).toEqual({
      'm/b': null,
      'm/c': 'm/c',
    });
    expect(filesDelta({ 'm/a': 'changed' }, { 'm/a': 'old' }, 2)).toEqual({ 'm/a': 'm/a' });
  });
  it('refuses a bundle that cannot fit even after stale files are deleted', () => {
    expect(() => filesDelta({ a: '1', b: '2' }, {}, 1)).toThrow();
    expect(() => filesDelta({ 'm/new': '1' }, { 'index.html': 'old' }, 1)).toThrow();
  });
});
