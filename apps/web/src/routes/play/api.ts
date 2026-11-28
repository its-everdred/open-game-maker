import { useQuery } from '@tanstack/react-query';

import { api, ApiError } from '../../lib/api/client';
import type { GameSummary } from '../games/types';

// What a shareable `/play/<ref>` link resolves to: the game, with the slug it answers to today so a stale link can be
// rewritten to the current one.
export type PlayLinkGame = GameSummary & { slug?: string | null };

export async function resolvePlayLink(ref: string): Promise<PlayLinkGame> {
  const { game } = await api<{ game: PlayLinkGame }>(`/games/resolve/${encodeURIComponent(ref)}`);
  return game;
}

export function usePlayLink(ref: string) {
  return useQuery({
    queryKey: ['play-link', ref],
    queryFn: () => resolvePlayLink(ref),
    enabled: ref !== '',
    retry: false,
  });
}

// 403 means the game exists but this visitor may not play it; 404 means the link points at nothing at all.
export type PlayLinkDenial = 'coming_soon' | 'denied' | 'missing' | 'unavailable';

export function playLinkDenial(error: unknown): PlayLinkDenial {
  if (error instanceof ApiError && error.status === 403) {
    if (
      typeof error.body === 'object' &&
      error.body !== null &&
      'error' in error.body &&
      error.body.error === 'coming_soon'
    )
      return 'coming_soon';
    return 'denied';
  }
  if (error instanceof ApiError && error.status === 404) return 'missing';
  return 'unavailable';
}

// Where a resolved link goes: a stale slug is first rewritten to the current one so the shared address heals, then the
// game opens in play mode with the link's own query (`chat`, for instance) intact.
export function playTarget(ref: string, game: PlayLinkGame, search: string): string {
  const canonical = game.slug ?? game.id;
  if (ref !== canonical && ref !== game.id) return `/play/${encodeURIComponent(canonical)}${search}`;
  const params = new URLSearchParams(search);
  params.set('mode', 'play');
  return `/g/${encodeURIComponent(game.id)}?${params.toString()}`;
}
