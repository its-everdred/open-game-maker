import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ReapplyReport } from '@ogm/contracts/browser';
import { getDesignSnapshot, getOptionalReapply, type DesignSnapshot, type listJobs } from '../../features/editor/api';
import { inspectBuildChange, readyBuildSignal } from '../../features/editor/builds';

type Options = {
  gameId: string;
  branch: string;
  jobBranch: string;
  activeSnapshot: DesignSnapshot | undefined;
  jobs: Awaited<ReturnType<typeof listJobs>>['jobs'] | undefined;
  setAdopted: Dispatch<SetStateAction<{ gameId: string; branch: string; snapshot: DesignSnapshot } | undefined>>;
  setPendingBuild: Dispatch<SetStateAction<{ snapshot: DesignSnapshot; report: ReapplyReport } | undefined>>;
};

export function useReadyBuild({
  gameId,
  branch,
  jobBranch,
  activeSnapshot,
  jobs,
  setAdopted,
  setPendingBuild,
}: Options): void {
  const inspectedBuild = useRef<string | undefined>(undefined);
  const inspectedJob = useRef<string | undefined>(undefined);
  useEffect(() => {
    inspectedBuild.current = undefined;
    inspectedJob.current = undefined;
  }, [branch, gameId]);
  useEffect(() => {
    const signal = readyBuildSignal(jobs ?? [], jobBranch);
    if (signal === undefined || signal === inspectedJob.current || activeSnapshot === undefined || gameId === '')
      return;
    inspectedJob.current = signal;
    let active = true;
    void getDesignSnapshot(gameId, branch)
      .then(async (next) => {
        if (!active || next.buildId === activeSnapshot.buildId || inspectedBuild.current === next.buildId) return;
        inspectedBuild.current = next.buildId;
        const change = await inspectBuildChange(activeSnapshot, next, () =>
          getOptionalReapply(gameId, branch, activeSnapshot.buildId, next.buildId),
        );
        if (!active) return;
        if (change.kind === 'switch') setAdopted({ gameId, branch, snapshot: change.snapshot });
        else if (change.kind === 'review') setPendingBuild({ snapshot: change.snapshot, report: change.report });
      })
      .catch(() => {
        inspectedJob.current = undefined;
        inspectedBuild.current = undefined;
      });
    return () => {
      active = false;
    };
  }, [activeSnapshot, branch, gameId, jobBranch, jobs, setAdopted, setPendingBuild]);
}
