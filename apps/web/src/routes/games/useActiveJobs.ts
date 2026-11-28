import { useQuery } from '@tanstack/react-query';

import { api, ApiError } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import { useAdminMe } from '../admin/api';
import { TERMINAL_JOB_STATES, type JobView } from './types';

type JobsResponse = JobView[] | { jobs: JobView[] };

export function useActiveJobs() {
  const { data: session } = useSession();
  const me = useAdminMe(Boolean(session));
  const userId = session?.user.id;
  const capability = me.data?.capability;
  const role = me.data?.platformRole;
  const enabled = Boolean(
    userId &&
    me.attested !== false &&
    capability &&
    (capability === 'creator' || role === 'admin' || role === 'maintainer'),
  );
  const query = useQuery({
    queryKey: ['jobs', 'active', userId, capability, role],
    enabled,
    queryFn: fetchActiveJobs,
    refetchInterval: (query) => nextActiveJobsPoll(query.state.data),
  });
  return { ...query, data: enabled ? query.data : undefined };
}

export function nextActiveJobsPoll(jobs: JobView[] | undefined): number | false {
  return jobs?.some((job) => !TERMINAL_JOB_STATES.has(job.state)) ? 10_000 : false;
}

export function indexActiveJobs(jobs: JobView[]): Map<string, JobView> {
  const byGame = new Map<string, JobView>();
  for (const job of jobs) {
    if (TERMINAL_JOB_STATES.has(job.state)) continue;
    const current = byGame.get(job.gameId);
    if (!current || (job.updatedAt ?? '') > (current.updatedAt ?? '')) byGame.set(job.gameId, job);
  }
  return byGame;
}

async function fetchActiveJobs(): Promise<JobView[]> {
  try {
    const response = await api<JobsResponse>('/jobs?state=active');
    return Array.isArray(response) ? response : response.jobs;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}
