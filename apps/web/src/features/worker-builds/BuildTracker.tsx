import { useId, useState } from 'react';
import type { CreatorCommand, Job } from '@ogm/contracts';
import { Icon } from '../../components/Icon';
import { MenuRing } from '../../components/MenuCircle';
import { Dialog } from '../../components/Dialog';
import { ReviewInbox } from './ReviewInbox';
import { openConversation } from '../build-chat/conversation';
import type { PastTicket } from './usePastTickets';
import type { WorkerReview } from './useWorkerReviews';
import type { FinishedWorker } from './useWorkerFinishes';
import './build-tracker.css';

export type WorkerBuild = {
  ticket: string;
  title: string;
  percent: number | null;
  etaSeconds: number | null;
  startedAt?: string;
  elapsedSeconds?: number;
  state?: string;
  phase?: string;
};

export function combinedPercent(workers: readonly WorkerBuild[]): number | null {
  return workers.length && workers.every((worker) => worker.percent !== null)
    ? Math.round(workers.reduce((sum, worker) => sum + worker.percent!, 0) / workers.length)
    : null;
}

type PanelProps = {
  workers: WorkerBuild[];
  reviews?: readonly WorkerReview[];
  commands?: readonly CreatorCommand[];
  past?: readonly PastTicket[];
  historyError?: boolean;
  historyLoading?: boolean;
  jobs?: readonly Job[];
};
export function BuildTracker({
  workers,
  finished = [],
  reviews = [],
  commands = [],
  past = [],
  historyError,
  historyLoading,
  jobs = [],
  onDismiss,
}: PanelProps & {
  finished?: readonly FinishedWorker[];
  onDismiss?(): void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (
    !workers.length &&
    !finished.length &&
    !reviews.length &&
    !commands.length &&
    !past.length &&
    !historyError &&
    !historyLoading
  )
    return null;
  const count = workers.length
    ? `${workers.length} ${workers.length === 1 ? 'build' : 'builds'} running`
    : reviews.length + commands.length
      ? `${reviews.length + commands.length} builds to review`
      : 'Completed builds';
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
          setOpen(!open);
        }}
      >
        <MenuRing percent={workers.length ? (combinedPercent(workers) ?? undefined) : undefined} />
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
      {open && (
        <BuildPanel
          workers={workers}
          reviews={reviews}
          commands={commands}
          past={past}
          historyError={historyError}
          historyLoading={historyLoading}
          jobs={jobs}
          id={id}
        />
      )}
    </div>
  );
}

export function BuildPanel({
  workers,
  reviews = [],
  commands = [],
  past = [],
  historyError,
  historyLoading,
  jobs = [],
  id,
}: PanelProps & { id: string }) {
  const [modal, setModal] = useState<'review' | 'completed'>();
  const reviewCount = reviews.length + commands.length;
  return (
    <section className="worker-tracker-panel" id={id} aria-label="Builds">
      <h2>Builds</h2>
      {reviewCount > 0 && (
        <button type="button" className="worker-tracker-summary" onClick={() => setModal('review')}>
          {reviewCount} Needs Review
        </button>
      )}
      <ul className="worker-tracker-list">
        {workers.map((worker) => (
          <li key={worker.ticket}>
            <div>
              <strong>{worker.title}</strong>
              <span>
                {waitingLabel(worker.state) ??
                  (worker.percent === 100 ? 'Finishing' : worker.percent == null ? '' : `${worker.percent}%`)}
              </span>
            </div>
            {!waitingLabel(worker.state) && worker.percent != null && worker.percent < 100 && (
              <span className="worker-tracker-bar">
                <span style={{ width: `${worker.percent}%` }} />
              </span>
            )}
            {(worker.phase || worker.elapsedSeconds != null) && !waitingLabel(worker.state) && (
              <small>
                {[
                  worker.phase,
                  worker.elapsedSeconds == null
                    ? undefined
                    : `${Math.floor(worker.elapsedSeconds / 60)}m ${worker.elapsedSeconds % 60}s elapsed`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            )}
          </li>
        ))}
        <li>
          <button type="button" onClick={() => setModal('completed')}>
            Completed
          </button>
        </li>
      </ul>
      {modal === 'review' && <ReviewInbox reviews={reviews} commands={commands} onClose={() => setModal(undefined)} />}
      {modal === 'completed' && (
        <Dialog
          title="Completed"
          className="job-conversation-dialog"
          backdropClassName="job-conversation-backdrop"
          onClose={() => setModal(undefined)}
        >
          <button
            type="button"
            className="job-conversation-close"
            aria-label="Close"
            onClick={() => setModal(undefined)}
          >
            ×
          </button>
          {historyLoading && <p>Loading completed tickets…</p>}
          {historyError && <p role="alert">Could not load completed tickets.</p>}
          <ul className="worker-tracker-list">
            {past.map((ticket) => {
              const job = jobs.find(
                (item) => item.gameId === ticket.gameId && String(item.aiurIssueNumber) === ticket.ticket,
              );
              return (
                <li key={`${ticket.gameId}:${ticket.ticket}`}>
                  {job ? (
                    <button
                      type="button"
                      onClick={() => {
                        setModal(undefined);
                        openConversation(job.id);
                      }}
                    >
                      {ticket.title} · {ticket.outcome}
                    </button>
                  ) : (
                    <a href={ticket.url} target="_blank" rel="noreferrer">
                      {ticket.title} · {ticket.outcome}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </Dialog>
      )}
    </section>
  );
}

function waitingLabel(state?: string): string | undefined {
  return (
    { 'human-review': 'Needs review', 'ci-wait': 'Waiting for checks', merging: 'Merging' } as Record<string, string>
  )[state ?? ''];
}
