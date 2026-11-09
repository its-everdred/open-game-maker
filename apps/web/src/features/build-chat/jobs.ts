import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { BudgetStatus, Job } from '@ogm/contracts';

import { queryClient } from '../../app/query';
import { api, ApiError } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import { subscribeNotification } from '../../lib/notify';

type GameSummary = { id: string; title?: string };
type JobsData = { jobs: Job[]; games: GameSummary[] };
const EMPTY_JOBS: Job[] = [];
const EMPTY_GAMES: GameSummary[] = [];

export const myJobsQueryKey = ['build-chat', 'jobs'] as const;
export const gameJobsQueryKey = (gameId: string) => ['game-jobs', gameId] as const;

export function useMyJobs() {
  const { data: session } = useSession();
  const creatorId = session?.user.id;
  const query = useQuery({
    queryKey: [...myJobsQueryKey, creatorId],
    enabled: Boolean(creatorId),
    queryFn: () => fetchMyJobs(creatorId!),
    refetchInterval: ({ state }) =>
      (state.data as JobsData | undefined)?.jobs.some((job) => !isTerminal(job.state)) ? 30_000 : false,
  });

  useEffect(() => subscribeNotification(refreshJobsForNotification), []);

  const jobs = query.data?.jobs ?? EMPTY_JOBS;
  return {
    ...query,
    jobs,
    games: query.data?.games ?? EMPTY_GAMES,
    active: jobs.filter((job) => !isTerminal(job.state)),
  };
}

export function useBudgetUnitLabel(): string {
  const { data } = useQuery({
    queryKey: ['build-chat', 'budget-unit'],
    queryFn: async () => {
      try {
        return (await api<BudgetStatus>('/budget/status')).unitLabel;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return 'coins';
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
  return data ?? 'coins';
}

export async function cancelJob(jobId: string): Promise<void> {
  await api(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  await queryClient.invalidateQueries({ queryKey: myJobsQueryKey });
}

// Pause and resume reach the ticket's agent through the game's aiur daemon (gm build pause|resume, #662).
export async function setJobPaused(jobId: string, paused: boolean): Promise<void> {
  await api(`/jobs/${encodeURIComponent(jobId)}/${paused ? 'pause' : 'resume'}`, { method: 'POST' });
  await queryClient.invalidateQueries({ queryKey: myJobsQueryKey });
}

export function refreshJobsForNotification(kind: 'build.done' | 'job.started' | 'intake.report'): void {
  if (kind === 'build.done' || kind === 'job.started') {
    void queryClient.invalidateQueries({ queryKey: myJobsQueryKey });
  }
}

export async function fetchMyJobs(creatorId: string): Promise<JobsData> {
  const { games } = await api<{ games: GameSummary[] }>('/games');
  const results = await Promise.allSettled(
    games.map(({ id }) => api<JobsData>(`/jobs?gameId=${encodeURIComponent(id)}`)),
  );
  const pages = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  if (games.length > 0 && pages.length === 0) {
    throw results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
  }
  return {
    games,
    jobs: pages
      .flatMap(({ jobs }) => jobs)
      .filter((job) => job.creatorId === creatorId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  };
}

export function isTerminal(state: Job['state']): boolean {
  return state === 'done' || state === 'failed' || state === 'cancelled';
}
