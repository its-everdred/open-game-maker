import { activityProgress } from './activity-progress';
import type { WorkerBuild } from './BuildTracker';
import './activity-ring.css';

/** Decorative ring for a menu control; its accessible description belongs to that control. */
export function ActivityRing({ workers }: { workers: readonly WorkerBuild[] }) {
  const { count, percent } = activityProgress(workers);
  if (count === 0) return null;

  return (
    <svg className="activity-ring" viewBox="0 0 44 44" aria-hidden="true">
      <circle className="activity-ring-track" cx="22" cy="22" r="20" />
      {percent !== null && (
        <circle
          className="activity-ring-fill"
          cx="22"
          cy="22"
          r="20"
          pathLength="100"
          strokeDasharray={`${percent} 100`}
        />
      )}
    </svg>
  );
}
