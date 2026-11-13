import { useQueries } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import type { WorkerBuild } from './BuildTracker';

type Game = { id: string };
type WorkersPage = {
  workers: WorkerBuild[];
  cursor?: number;
  completed?: Array<{ ticket: string; seq: number; at: string }>;
};
export type WorkerFeed = {
  gameId: string;
  cursor: number;
  completed: Array<{ ticket: string; seq: number; at: string }>;
};

// Each game daemon owns a distinct ticket namespace. Keep that identity when combining library results.
export function useWorkers(games: readonly Game[], currentGameId?: string, creatorId?: string) {
  const selected = currentGameId ? games.filter((game) => game.id === currentGameId) : games;
  const queries = useQueries({
    queries: selected.map((game) => ({
      queryKey: ['game-workers', creatorId, game.id],
      queryFn: () => api<WorkersPage>(`/games/${encodeURIComponent(game.id)}/workers`),
      enabled: Boolean(creatorId),
      refetchInterval: 5_000,
      retry: false,
    })),
  });
  const workers = queries.flatMap((query, index) =>
    (query.isError ? [] : (query.data?.workers ?? [])).map((worker) => ({
      ...worker,
      ticket: `${selected[index]!.id}:${worker.ticket}`,
    })),
  );
  const feeds: WorkerFeed[] = queries.flatMap((query, index) =>
    !query.isError && query.data
      ? [
          {
            gameId: selected[index]!.id,
            cursor: query.data.cursor ?? 0,
            completed: query.data.completed ?? [],
          },
        ]
      : [],
  );
  return { workers, feeds };
}
