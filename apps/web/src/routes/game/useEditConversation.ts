import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gameJobsQueryKey, isTerminal } from '../../features/build-chat/jobs';
import { listJobs } from '../../features/editor/api';
import { useSession } from '../../lib/api/session';

export function useEditConversation(gameId: string, branchId: string) {
  const jobs = useQuery({
    queryKey: gameJobsQueryKey(gameId),
    queryFn: () => listJobs(gameId),
    enabled: gameId !== '',
    refetchInterval: 5_000,
  });
  const rows = jobs.data?.jobs;
  const { data: session } = useSession();
  const [admittedJobId, setAdmittedJobId] = useState<string>();
  const previousJob = useRef<string | undefined>(undefined);
  useEffect(() => {
    setAdmittedJobId(undefined);
    previousJob.current = undefined;
  }, [gameId, branchId]);
  const eligible = rows?.filter(
    (job) => job.branchId === branchId && job.creatorId === session?.user?.id && !isTerminal(job.state),
  );
  const job =
    eligible?.find((item) => item.id === admittedJobId) ??
    eligible?.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (job) previousJob.current = job.id;
  const completed = rows?.find((item) => item.id === (admittedJobId ?? previousJob.current) && isTerminal(item.state));
  return {
    jobs,
    job,
    admittedJobId: completed ? undefined : admittedJobId,
    completedJobId: completed?.id,
    onAdmitted: setAdmittedJobId,
  };
}
