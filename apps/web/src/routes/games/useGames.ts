import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';

import { api } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import { useAdminMe } from '../admin/api';
import type { GameSummary } from './types';

type GamesResponse = GameSummary[] | { games: GameSummary[] };
let nextAccessEpoch = 0;

export function useGames() {
  const { data: session } = useSession();
  const userId = session?.user.id;
  const me = useAdminMe(Boolean(userId));
  const capability = userId && me.data?.user?.id === userId ? me.data.capability : undefined;
  const platformRole = userId && me.data?.user?.id === userId ? me.data.platformRole : undefined;
  const access = `${userId ?? ''}:${capability ?? ''}:${platformRole ?? ''}`;
  const epoch = useRef<{ access: string; value: number } | null>(null);
  if (epoch.current?.access !== access) epoch.current = { access, value: ++nextAccessEpoch };
  return useQuery({
    queryKey: ['games', userId, capability, platformRole, epoch.current.value],
    enabled: Boolean(userId && capability),
    queryFn: async ({ signal }) => {
      const games = unwrapGames(await api<GamesResponse>('/games', { signal }));
      return games;
    },
  });
}

export function unwrapGames(response: GamesResponse): GameSummary[] {
  return Array.isArray(response) ? response : response.games;
}
