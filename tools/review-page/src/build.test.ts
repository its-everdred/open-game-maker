import { expect, it } from 'vitest';
import { isReviewable, renderPage, selectCards } from './build.js';
import type { Card } from './cards.js';

const card = (key: string): Card => ({
  key,
  repo: 'core',
  ticket: 1,
  decision: key,
  title: key,
  at: '',
  mode: 'review',
  shared: [],
  options: [],
});

it('requires review media or a playable link for creator-facing cards', () => {
  expect(isReviewable(card('text-only'))).toBe(false);
  expect(isReviewable({ ...card('play'), play: 'https://example.test/g/demo' })).toBe(true);
  expect(isReviewable({ ...card('image'), shared: [{ kind: 'img', src: 'm/image.jpg' }] })).toBe(true);
});

it('keeps recent closed answers and removes old answers during the next build', () => {
  const now = 1_000_000;
  const current = [card('open'), card('old')];
  const previous = [card('recent'), card('closed')];
  expect(selectCards(current, previous, { old: now - 600_001, recent: now - 100 }, now).map((c) => c.key)).toEqual([
    'open',
    'recent',
  ]);
});

it('escapes script closing tags in card data', () => {
  expect(renderPage('<script>__DATA__</script>', [card('</script><script>')])).toContain('<\\/script>');
});

it('shows a changed Command re-raised after an old pick', () => {
  const at = Date.parse('2026-11-26T00:00:00Z');
  const old = { ...card('dec_a'), title: 'Old look', at: '2026-11-25T00:00:00Z' };
  const changed = { ...old, title: 'New look', at: '2026-11-26T00:01:00Z' };
  const baseline = { dec_a: { at, card: old } };
  expect(selectCards([changed], [old], { dec_a: at }, at + 700_000, baseline)[0]?.ignoreSavedBefore).toBe(at);
  expect(selectCards([{ ...old, at: changed.at }], [old], { dec_a: at }, at + 700_000, baseline)).toEqual([]);
});
