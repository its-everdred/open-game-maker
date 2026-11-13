import { useQueries } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { gamePath } from '@ogm/contracts/browser';
import { api } from '../../lib/api/client';
import type { Preview } from '../../routes/review/PreviewReviews';
import type { WorkerBuild, WorkerReview } from './BuildTracker';

type Game = { id: string; slug?: string | null };

export function useWorkerReviews(games: readonly Game[], workers: readonly WorkerBuild[], creatorId?: string) {
  const titles = useRef(new Map<string, string>());
  const scope = useRef(creatorId);
  if (scope.current !== creatorId) {
    titles.current.clear();
    scope.current = creatorId;
  }
  useEffect(() => {
    for (const worker of workers) titles.current.set(worker.ticket, worker.title);
  }, [workers]);
  const queries = useQueries({
    queries: games.map((game) => ({
      queryKey: ['build-previews', creatorId, game.id],
      enabled: Boolean(creatorId && game.slug),
      queryFn: () => api<{ previews: Preview[] }>(`/games/${encodeURIComponent(game.id)}/previews`),
      refetchInterval: 5_000,
      retry: false,
    })),
  });
  return queries.flatMap((query, index): WorkerReview[] => {
    const game = games[index]!;
    if (!game.slug || query.isError || !creatorId) return [];
    return (query.data?.previews ?? []).map((preview) => {
      const ticket = `${game.id}:${preview.ticket}`;
      return {
        ticket,
        title: preview.title || titles.current.get(ticket) || 'Ready to review',
        href: `${gamePath(game.slug!)}/review#preview-${encodeURIComponent(preview.buildId)}`,
      };
    });
  });
}
