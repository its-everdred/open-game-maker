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

/** The art a list response promises for each card: a cover for a coverUrl, a logo for a logoUrl. */
export function expectedParts(games: unknown): Array<Pick<CardPart, 'gameId' | 'title' | 'part'>> {
  const list = Array.isArray(games)
    ? games
    : games && typeof games === 'object' && Array.isArray((games as { games?: unknown }).games)
      ? (games as { games: unknown[] }).games
      : null;
  if (!list) throw new Error('the cards file is not a games list');
  return list.flatMap((value) => {
    const game = value as { id?: unknown; title?: unknown; coverUrl?: unknown; logoUrl?: unknown };
    if (typeof game.id !== 'string') return [];
    const title = typeof game.title === 'string' ? game.title : game.id;
    return [
      ...(typeof game.coverUrl === 'string' ? [{ gameId: game.id, title, part: 'cover' as const }] : []),
      ...(typeof game.logoUrl === 'string' ? [{ gameId: game.id, title, part: 'logo' as const }] : []),
    ];
  });
}

/** Every piece of art that never showed, or showed and then went away (#1312: logos appeared, then vanished). */
export function cardFailures(parts: CardPart[], loadMs: number): string[] {
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
