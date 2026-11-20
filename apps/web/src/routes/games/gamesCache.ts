import type { GameSummary } from './types';
import { preloadDisplayImage } from './DisplayImage';

const prefix = 'ogm.games.v1.';

export function readGames(userId: string | undefined): GameSummary[] | undefined {
  if (!userId) return undefined;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(prefix + userId) ?? 'null');
    return Array.isArray(value) && value.every(isCachedGame) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveGames(userId: string | undefined, games: GameSummary[]): void {
  if (!userId) return;
  try {
    localStorage.setItem(prefix + userId, JSON.stringify(games));
  } catch {
    // Storage can be disabled or full; the live query still works.
  }
}

export function preloadGames(userId: string | undefined): void {
  for (const game of readGames(userId) ?? []) {
    preloadDisplayImage(
      game.coverImage,
      game.coverUrl,
      '(max-width: 600px) 45vw, (max-width: 1000px) 25vw, 240px',
      game.slotImages?.tile,
    );
    preloadDisplayImage(game.logoImage, game.logoUrl, '(max-width: 600px) 55vw, 320px');
  }
}

function isCachedGame(value: unknown): value is GameSummary {
  if (!value || typeof value !== 'object') return false;
  const game = value as Record<string, unknown>;
  // Showcase data is derived locally, never part of the API response.
  if (game.showcase != null) return false;
  if (game.stats != null) {
    if (typeof game.stats !== 'object' || Array.isArray(game.stats)) return false;
    const stats = game.stats as Record<string, unknown>;
    if (stats.version != null && typeof stats.version !== 'string') return false;
    if (stats.plays != null && typeof stats.plays !== 'number') return false;
  }
  if (!['id', 'familyId', 'ownerId', 'title', 'createdAt'].every((key) => typeof game[key] === 'string')) return false;
  for (const key of ['slug', 'updatedAt', 'lastPlayedAt', 'coverUrl', 'logoUrl', 'trailerUrl', 'tagline']) {
    if (game[key] != null && typeof game[key] !== 'string') return false;
  }
  if (game.tags != null && (!Array.isArray(game.tags) || !game.tags.every((tag: unknown) => typeof tag === 'string')))
    return false;
  if (game.choices != null) {
    if (typeof game.choices !== 'object' || Array.isArray(game.choices)) return false;
    const choices = game.choices as Record<string, unknown>;
    if (
      !['genre', 'vibe'].every(
        (key) =>
          choices[key] == null ||
          (Array.isArray(choices[key]) && (choices[key] as unknown[]).every((item) => typeof item === 'string')),
      )
    )
      return false;
  }
  for (const key of ['coverImage', 'logoImage']) {
    const image = game[key];
    if (image == null) continue;
    if (typeof image !== 'object') return false;
    const data = image as Record<string, unknown>;
    if (
      typeof data.width !== 'number' ||
      typeof data.height !== 'number' ||
      !data.sources ||
      typeof data.sources !== 'object'
    )
      return false;
    const sources = data.sources as Record<string, unknown>;
    if (
      !['avif', 'webp', 'png'].every((format) => {
        const entries = sources[format];
        return (
          Array.isArray(entries) &&
          entries.length > 0 &&
          entries.every((entry: unknown) => {
            if (!entry || typeof entry !== 'object') return false;
            const item = entry as Record<string, unknown>;
            return typeof item.path === 'string' && typeof item.width === 'number';
          })
        );
      })
    )
      return false;
  }
  if (game.slotImages != null) {
    if (typeof game.slotImages !== 'object' || Array.isArray(game.slotImages)) return false;
    const slots = game.slotImages as Record<string, unknown>;
    for (const [slot, value] of Object.entries(slots)) {
      if (!['tile', 'logo', 'loading', 'title', 'store-icon', 'review-media', 'hud-panel', 'background'].includes(slot))
        return false;
      if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
      for (const [viewport, image] of Object.entries(value)) {
        if (!['phone-portrait', 'phone-landscape', 'tablet-portrait', 'tablet-landscape', 'desktop'].includes(viewport))
          return false;
        if (image == null || typeof image !== 'object' || Array.isArray(image)) return false;
        const data = image as Record<string, unknown>;
        const sources = data.sources as Record<string, unknown> | undefined;
        if (
          typeof data.width !== 'number' ||
          typeof data.height !== 'number' ||
          !sources ||
          !['avif', 'webp', 'png'].every((format) => {
            const entries = sources[format];
            return (
              Array.isArray(entries) &&
              entries.length > 0 &&
              entries.every(
                (entry: unknown) =>
                  !!entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).path === 'string' &&
                  typeof (entry as Record<string, unknown>).width === 'number',
              )
            );
          })
        )
          return false;
      }
    }
  }
  return true;
}
