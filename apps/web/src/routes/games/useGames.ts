import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import { readGames, saveGames } from './gamesCache';
import type { GameSummary } from './types';

type GamesResponse = GameSummary[] | { games: GameSummary[] };

export function useGames() {
  const { data: session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['games', userId],
    initialData: () => readGames(userId),
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }) => {
      const games = unwrapGames(await api<GamesResponse>('/games', { signal }));
      if (!signal.aborted) saveGames(userId, games);
      return games;
    },
  });
}

export function unwrapGames(response: GamesResponse): GameSummary[] {
  return Array.isArray(response) ? response : response.games;
}
