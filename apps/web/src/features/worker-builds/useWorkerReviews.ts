import { useQueries } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import type { Preview } from '../../routes/review/PreviewReviews';
import type { Round } from '../../routes/review/RoundReviews';

export type WorkerReview =
  { kind: 'round'; gameId: string; round: Round } | { kind: 'preview'; gameId: string; preview: Preview };

type Game = { id: string; slug?: string | null };

// Gameplay rounds are represented by their playable preview; the rounds endpoint excludes them.
export function useWorkerReviews(games: readonly Game[], creatorId?: string) {
  const queries = useQueries({
    queries: games.flatMap((game) => [
      {
        queryKey: ['game-review-rounds', game.id, creatorId],
        enabled: Boolean(creatorId),
        queryFn: () => api<{ rounds: Round[] }>(`/games/${encodeURIComponent(game.id)}/review-rounds`),
        refetchInterval: 5_000,
        retry: false,
      },
      {
        queryKey: ['game-previews', game.id, creatorId],
        enabled: Boolean(creatorId),
        queryFn: () => api<{ previews: Preview[] }>(`/games/${encodeURIComponent(game.id)}/previews`),
        refetchInterval: 5_000,
        retry: false,
      },
    ]),
  });
  if (!creatorId) return [];
  return games.flatMap((game, index): WorkerReview[] => {
    const rounds = queries[index * 2]?.data as { rounds: Round[] } | undefined;
    const previews = queries[index * 2 + 1]?.data as { previews: Preview[] } | undefined;
    return [
      ...(rounds?.rounds ?? []).map((round): WorkerReview => ({ kind: 'round', gameId: game.id, round })),
      ...(previews?.previews ?? []).map((preview): WorkerReview => ({ kind: 'preview', gameId: game.id, preview })),
    ];
  });
}
