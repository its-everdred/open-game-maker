import { useQueries } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

export type PastTicket = {
  gameId: string;
  ticket: string;
  title: string;
  outcome: string;
  closedAt: string;
  url: string;
};
export function usePastTickets(games: readonly { id: string }[], creatorId?: string) {
  const queries = useQueries({
    queries: games.map((game) => ({
      queryKey: ['completed-tickets', creatorId, game.id],
      enabled: Boolean(creatorId),
      queryFn: () =>
        api<{ tickets: Omit<PastTicket, 'gameId'>[] }>(`/games/${encodeURIComponent(game.id)}/tickets/completed`),
      refetchInterval: 60_000,
      retry: false,
    })),
  });
  return {
    tickets: creatorId
      ? queries
          .flatMap((query, index) =>
            (query.data?.tickets ?? []).map((ticket) => ({ ...ticket, gameId: games[index]!.id })),
          )
          .sort((a, b) => b.closedAt.localeCompare(a.closedAt))
      : [],
    error: queries.some((query) => query.isError),
    loading: queries.some((query) => query.isLoading),
  };
}
