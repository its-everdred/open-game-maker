import { useQueries } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import type { WorkerBuild } from './BuildTracker';

type Game = { id: string };
type WorkersPage = { workers: WorkerBuild[] };

// Each game daemon owns a distinct ticket namespace. Keep that identity when combining library results.
export function useWorkers(games: readonly Game[], currentGameId?: string) {
  const selected = currentGameId ? games.filter((game) => game.id === currentGameId) : games;
  const queries = useQueries({
    queries: selected.map((game) => ({
      queryKey: ['game-workers', game.id],
      queryFn: () => api<WorkersPage>(`/games/${encodeURIComponent(game.id)}/workers`),
      refetchInterval: 5_000,
      retry: false,
    })),
  });
  return queries.flatMap((query, index) =>
    (query.data?.workers ?? []).map((worker) => ({ ...worker, ticket: `${selected[index]!.id}:${worker.ticket}` })),
  );
}
