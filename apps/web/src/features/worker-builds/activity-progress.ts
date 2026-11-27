import type { WorkerBuild } from './BuildTracker';

/** Progress for currently working agents; an unknown value must not be presented as a percentage. */
export function activityProgress(workers: readonly WorkerBuild[]): { count: number; percent: number | null } {
  const active = workers.filter((worker) => worker.state !== 'human-review');
  if (active.length === 0) return { count: 0, percent: null };
  if (active.some((worker) => worker.percent === null || !Number.isFinite(worker.percent))) {
    return { count: active.length, percent: null };
  }
  const total = active.reduce((sum, worker) => sum + Math.min(100, Math.max(0, worker.percent!)), 0);
  return { count: active.length, percent: Math.round(total / active.length) };
}
