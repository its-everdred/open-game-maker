import { useQueries } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import type { Preview } from '../../routes/review/PreviewReviews';
import type { Round } from '../../routes/review/RoundReviews';

export type WorkerReview =
  { kind: 'round'; gameId: string; round: Round } | { kind: 'preview'; gameId: string; preview: Preview; round: Round };

type Game = { id: string; slug?: string | null };

// Gameplay rounds are represented by their playable preview; the rounds endpoint excludes them.
export function useWorkerReviews(games: readonly Game[], creatorId?: string) {
  const queries = useQueries({
    queries: games.flatMap((game) => [
      {
        queryKey: ['game-review-rounds', game.id, creatorId],
        enabled: Boolean(creatorId),
        queryFn: () =>
          api<{ rounds: Round[] }>(`/games/${encodeURIComponent(game.id)}/review-rounds?includeGameplay=1`),
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
  if (!creatorId) return { reviews: [], error: false, loading: false };
  const reviews = games.flatMap((game, index): WorkerReview[] => {
    const rounds = queries[index * 2]?.data as { rounds: Round[] } | undefined;
    const previews = queries[index * 2 + 1]?.data as { previews: Preview[] } | undefined;
    return [
      ...(rounds?.rounds ?? []).map((round): WorkerReview => {
        const preview = previews?.previews.find(
          (item) => item.ticket === round.ticket && item.buildId === round.buildId,
        );
        return preview
          ? { kind: 'preview', gameId: game.id, preview, round }
          : { kind: 'round', gameId: game.id, round };
      }),
    ];
  });
  return { reviews, error: queries.some((query) => query.isError), loading: queries.some((query) => query.isLoading) };
}
