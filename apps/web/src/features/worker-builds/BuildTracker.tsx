import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { MenuRing } from '../../components/MenuCircle';
import type { FinishedWorker } from './useWorkerFinishes';
import './build-tracker.css';

export type WorkerBuild = {
  ticket: string;
  title: string;
  percent: number | null;
  etaSeconds: number | null;
  startedAt?: string;
};
export type WorkerReview = { ticket: string; title: string; href: string };

export function combinedPercent(workers: readonly WorkerBuild[]): number | null {
  return workers.length && workers.every((worker) => worker.percent !== null)
    ? Math.round(workers.reduce((sum, worker) => sum + worker.percent!, 0) / workers.length)
    : null;
}

export function BuildTracker({
  workers,
  finished = [],
  reviews = [],
  onDismiss,
}: {
  workers: WorkerBuild[];
  finished?: readonly FinishedWorker[];
  reviews?: readonly WorkerReview[];
  onDismiss?(): void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!workers.length && !finished.length && !reviews.length) return null;
  const count = workers.length
    ? `${workers.length} ${workers.length === 1 ? 'build' : 'builds'} running`
    : reviews.length
      ? `${reviews.length} ${reviews.length === 1 ? 'build' : 'builds'} to review`
      : `${finished.length} ${finished.length === 1 ? 'build' : 'builds'} finished`;
  return (
    <div className="worker-tracker">
      <button
        type="button"
        className="worker-tracker-button"
        aria-label={count}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          onDismiss?.();
          if (workers.length || reviews.length) setOpen(!open);
        }}
      >
        <MenuRing percent={workers.length ? (combinedPercent(workers) ?? undefined) : 100} />
        <Icon name="build" />
        <span className="worker-tracker-count" aria-hidden="true">
          {workers.length || '✓'}
        </span>
      </button>
      {finished.length > 0 && (
        <span className="worker-tracker-toast" role="status">
          {finished.at(-1)!.title} is ready
        </span>
      )}
      {open && <BuildPanel workers={workers} reviews={reviews} id={id} />}
    </div>
  );
}

export function BuildPanel({
  workers,
  reviews = [],
  id,
}: {
  workers: WorkerBuild[];
  reviews?: readonly WorkerReview[];
  id: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!workers.length && !reviews.length) return null;
  const percent = combinedPercent(workers);
  const first = [...workers].sort((a, b) => (a.etaSeconds ?? Infinity) - (b.etaSeconds ?? Infinity))[0];
  return (
    <section className="worker-tracker-panel" id={id} aria-label="Builds">
      <h2>Builds</h2>
      {first && (
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
      )}
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
      {reviews.length > 0 && (
        <ul className="worker-tracker-list">
          {reviews.map((review) => (
            <li key={review.href}>
              <Link to={review.href}>{review.title}</Link>
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
