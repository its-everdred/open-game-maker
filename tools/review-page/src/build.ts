import type { Card } from './cards.ts';
import { keepReviewCard } from './retention.ts';

/** Creator-facing cards need review media or a playable/review link. */
export function isReviewable(card: Card): boolean {
  return !!(
    card.play ||
    card.link ||
    card.shared.length ||
    card.options.some((option) => option.media.length) ||
    card.groups?.some((group) => group.media.length || group.options.some((option) => option.media.length)) ||
    card.rows?.some((row) => row.cells.some((cell) => cell.media.length))
  );
}

/** Retain a recently answered card even if its Command closed after the pick. */
export function selectCards(
  open: Card[],
  previous: Card[],
  picks: Record<string, number>,
  now: number,
  baselines: Record<string, { at: number; card: Card }> = {},
): Card[] {
  const byKey = new Map(open.map((card) => [card.key, card]));
  for (const card of previous) {
    if (!byKey.has(card.key) && picks[card.key] !== undefined && keepReviewCard(picks[card.key], now)) {
      byKey.set(card.key, card);
    }
  }
  return [...byKey.values()].flatMap((card) => {
    const picked = picks[card.key];
    if (keepReviewCard(picked, now)) return [card];
    const baseline = baselines[card.key];
    const content = (value: Card) =>
      JSON.stringify([
        value.title,
        value.options,
        value.groups,
        value.rows,
        value.shared,
        value.link,
        value.play,
        value.take,
      ]);
    if (
      picked !== undefined &&
      baseline?.at === picked &&
      Date.parse(card.at) > picked &&
      content(card) !== content(baseline.card)
    ) {
      return [{ ...card, ignoreSavedBefore: picked }];
    }
    return [];
  });
}

/** JSON is inert inside the script element even when a title contains HTML. */
export function renderPage(template: string, cards: Card[]): string {
  if (!template.includes('__DATA__')) throw new Error('Review page template is missing its data placeholder');
  return template.replace('__DATA__', JSON.stringify(cards).replaceAll('</', '<\\/'));
}
