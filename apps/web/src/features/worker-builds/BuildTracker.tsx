import { useId, useState } from 'react';
import { Icon } from '../../components/Icon';
import { MenuRing } from '../../components/MenuCircle';
import './build-tracker.css';

export type WorkerBuild = { ticket: string; title: string; percent: number | null; etaSeconds: number | null };

export function combinedPercent(workers: readonly WorkerBuild[]): number | null {
  return workers.length && workers.every((worker) => worker.percent !== null)
    ? Math.round(workers.reduce((sum, worker) => sum + worker.percent!, 0) / workers.length)
    : null;
}

export function BuildTracker({ workers }: { workers: WorkerBuild[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!workers.length) return null;
  const count = `${workers.length} ${workers.length === 1 ? 'build' : 'builds'} running`;
  return (
    <div className="worker-tracker">
      <button
        type="button"
        className="worker-tracker-button"
        aria-label={count}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <MenuRing percent={combinedPercent(workers) ?? undefined} />
        <Icon name="build" />
        <span className="worker-tracker-count" aria-hidden="true">
          {workers.length}
        </span>
      </button>
      {open && <BuildPanel workers={workers} id={id} />}
    </div>
  );
}

export function BuildPanel({ workers, id }: { workers: WorkerBuild[]; id: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!workers.length) return null;
  const percent = combinedPercent(workers);
  const first = [...workers].sort((a, b) => (a.etaSeconds ?? Infinity) - (b.etaSeconds ?? Infinity))[0]!;
  return (
    <section className="worker-tracker-panel" id={id} aria-label="Builds">
      <h2>Builds</h2>
      <button
        type="button"
        className="worker-tracker-summary"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          {first.title}
          {first.etaSeconds === null ? '' : ` · about ${formatTime(first.etaSeconds)} left`}
        </span>
        <span>{percent === null ? '—' : `${percent}%`}</span>
        <span className="worker-tracker-bar">
          <span style={{ width: `${percent ?? 0}%` }} />
        </span>
        <small>{expanded ? 'Hide builds ▴' : 'Show each build ▾'}</small>
      </button>
      {expanded && (
        <ul id={`${id}-list`} className="worker-tracker-list">
          {workers.map((worker) => (
            <li key={worker.ticket}>
              <div>
                <strong>{worker.title}</strong>
                <span>{worker.etaSeconds === null ? '—' : formatTime(worker.etaSeconds)}</span>
              </div>
              <span className="worker-tracker-bar">
                <span style={{ width: `${worker.percent ?? 0}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.ceil(seconds));
  return value >= 60 ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` : `${value}s`;
}
