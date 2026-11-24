/** One piece of a game card's art the list must show: its thumbnail (cover) or its logo. */
export type CardPart = {
  gameId: string;
  title: string;
  part: 'cover' | 'logo';
  /** Milliseconds after the card scrolled into view that the art first showed; null when it never did. */
  shownAt: number | null;
  /** Milliseconds after it first showed that it stopped showing; null when it stayed for the whole hold. */
  lostAt: number | null;
  /** What the art was doing at the last sample: shown, loading, broken, hidden or missing. */
  state: string;
};

/** The games of a list response, in either shape the API has used: an array or `{ games: [...] }`. */
export function cardList(value: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { games?: unknown }).games)
      ? (value as { games: unknown[] }).games
      : null;
  if (!list) throw new Error('the cards file is not a games list');
  return list.filter((game): game is Record<string, unknown> => !!game && typeof game === 'object');
}

/** The art a list response promises for each card: a cover for a coverUrl, a logo for a logoUrl. */
export function expectedParts(
  games: Array<Record<string, unknown>>,
): Array<Pick<CardPart, 'gameId' | 'title' | 'part'>> {
  return games.flatMap((game) => {
    if (typeof game.id !== 'string') return [];
    const title = typeof game.title === 'string' ? game.title : game.id;
    return [
      ...(typeof game.coverUrl === 'string' ? [{ gameId: game.id, title, part: 'cover' as const }] : []),
      ...(typeof game.logoUrl === 'string' ? [{ gameId: game.id, title, part: 'logo' as const }] : []),
    ];
  });
}

/**
 * The same cards as a list cached before their display variants existed: originals only. The check shows these
 * first, so the reload swaps every card from cached art to the live list's, the change that blanked Kevin's logos.
 */
export function staleCards(games: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return games.map((game) => {
    const stale = { ...game };
    for (const key of ['coverImage', 'logoImage', 'slotImages']) delete stale[key];
    return stale;
  });
}

/** Every piece of art that never showed, or showed and then went away (#1312: logos appeared, then vanished). */
export function cardFailures(parts: CardPart[], loadMs: number, games: number): string[] {
  // A list of games whose cards declare no art at all checks nothing; that is not a pass.
  if (games > 0 && parts.length === 0) return [`none of the ${games} games has a thumbnail or logo to check`];
  return parts.flatMap((part) => {
    const name = `${part.title} ${part.part}`;
    if (part.shownAt === null) return [`${name}: not shown within ${Math.round(loadMs / 1000)} s (${part.state})`];
    if (part.lostAt !== null)
      return [`${name}: disappeared ${(part.lostAt / 1000).toFixed(1)} s after it showed (${part.state})`];
    return [];
  });
}

/* Runs in the page: whether the cell's art of this kind is on screen. A kept previous image counts: it is what shows. */
export function probeCardPart([gameId, part]: [string, 'cover' | 'logo']): string {
  const cell = [...document.querySelectorAll<HTMLElement>('[data-game-id]')].find(
    (item) => item.dataset.gameId === gameId,
  );
  if (!cell) return 'missing';
  const images = [
    ...cell.querySelectorAll<HTMLImageElement>(part === 'cover' ? 'img.game-cover-image' : 'img.game-logo'),
  ];
  if (!images.length) return 'missing';
  const states = images.map((image) => {
    if (!image.complete) return 'loading';
    if (image.naturalWidth === 0) return 'broken';
    const style = getComputedStyle(image);
    const box = image.getBoundingClientRect();
    return style.visibility === 'hidden' || Number(style.opacity) === 0 || box.width === 0 || box.height === 0
      ? 'hidden'
      : 'shown';
  });
  return states.includes('shown') ? 'shown' : states[0]!;
}
