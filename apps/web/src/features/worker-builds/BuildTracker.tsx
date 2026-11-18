import { useId, useState } from 'react';
import type { Job } from '@ogm/contracts';
import { commandSource, type ReviewCommand, type ReviewTarget } from './review-command';
import { Icon } from '../../components/Icon';
import { MenuRing } from '../../components/MenuCircle';
import { Dialog } from '../../components/Dialog';
import { ReviewInbox } from './ReviewInbox';
import { openConversation } from '../build-chat/conversation';
import { TicketConversation } from './TicketConversation';
import { TicketDetail } from './TicketDetail';
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
  commands?: readonly ReviewCommand[];
  coreTargets?: readonly ReviewTarget[];
  past?: readonly PastTicket[];
  historyError?: boolean;
  historyLoading?: boolean;
  reviewError?: boolean;
  reviewLoading?: boolean;
  workerError?: boolean;
  creatorId?: string;
  jobs?: readonly Job[];
};
export function BuildTracker({
  workers,
  finished = [],
  reviews = [],
  commands = [],
  coreTargets = [],
  past = [],
  historyError,
  historyLoading,
  reviewError,
  reviewLoading,
  workerError,
  creatorId,
  jobs = [],
  onDismiss,
}: PanelProps & {
  finished?: readonly FinishedWorker[];
  onDismiss?(): void;
}) {
  const [open, setOpen] = useState(false);
  const [openReview, setOpenReview] = useState(false);
  const id = useId();
  if (
    !workers.length &&
    !finished.length &&
    !reviews.length &&
    !commands.length &&
    !coreTargets.length &&
    !past.length &&
    !historyError &&
    !historyLoading &&
    !workerError &&
    !reviewError &&
    !openReview
  )
    return null;
  const targets = [...missingReviewTargets(workers, reviews, commands), ...coreTargets];
  const pending = reviews.length + commands.length + targets.length;
  const count = workers.length
    ? `${workers.length} ${workers.length === 1 ? 'build' : 'builds'} running`
    : pending
      ? `${pending} builds to review`
      : 'Completed builds';
  return (
    <div className="worker-tracker">
      <button
        type="button"
        className="worker-tracker-button"
        aria-label={count}
        aria-expanded={open || openReview}
        aria-controls={id}
        onClick={() => {
          onDismiss?.();
          if (pending > 0) setOpenReview(true);
          else setOpen(!open);
        }}
      >
        <MenuRing percent={workers.length ? (combinedPercent(workers) ?? undefined) : undefined} />
        <Icon name="hammer" />
        <span className="worker-tracker-count" aria-hidden="true">
          {pending || workers.length || '✓'}
        </span>
      </button>
      {finished.length > 0 && (
        <span className="worker-tracker-toast" role="status">
          {finished.at(-1)!.title} is ready
        </span>
      )}
      {openReview && (
        <ReviewInbox
          workers={workers}
          reviews={reviews}
          commands={commands}
          error={reviewError}
          incomplete={reviewLoading || workerError}
          targets={targets}
          onClose={() => setOpenReview(false)}
        />
      )}
      {open && (
        <BuildPanel
          workers={workers}
          reviews={reviews}
          commands={commands}
          coreTargets={coreTargets}
          past={past}
          historyError={historyError}
          creatorId={creatorId}
          workerError={workerError}
          reviewError={reviewError}
          reviewLoading={reviewLoading}
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
  coreTargets = [],
  past = [],
  historyError,
  historyLoading,
  reviewError,
  reviewLoading,
  workerError,
  creatorId,
  jobs = [],
  id,
}: PanelProps & { id: string }) {
  const [modal, setModal] = useState<'review' | 'completed'>();
  const [conversation, setConversation] = useState<PastTicket>();
  const [detail, setDetail] = useState<DetailTarget>();
  const targets = [...missingReviewTargets(workers, reviews, commands), ...coreTargets];
  const reviewCount = reviews.length + commands.length + targets.length;
  return (
    <section className="worker-tracker-panel" id={id} aria-label="Builds">
      <h2>Builds</h2>
      {workerError && <p role="alert">Could not load all build updates.</p>}
      {reviewError && <p role="alert">Could not load all reviews.</p>}
      {reviewCount > 0 && (
        <button type="button" className="worker-tracker-summary" onClick={() => setModal('review')}>
          {reviewCount} Needs Review
        </button>
      )}
      <ul className="worker-tracker-list">
        {workers.map((worker) => (
          <li key={worker.ticket}>
            {(() => {
              const row = (
                <>
                  <strong>{worker.title}</strong>
                  <span>
                    {waitingLabel(worker.state) ??
                      (worker.percent === 100 ? 'Finishing' : worker.percent == null ? '' : `${worker.percent}%`)}
                  </span>
                </>
              );
              // A worker's ticket is `<gameId>:<ticket>`; one without its game cannot open a detail.
              const separator = worker.ticket.lastIndexOf(':');
              return separator < 0 ? (
                <div>{row}</div>
              ) : (
                <button
                  type="button"
                  className="worker-tracker-row"
                  onClick={() =>
                    setDetail({
                      gameId: worker.ticket.slice(0, separator),
                      ticket: worker.ticket.slice(separator + 1),
                      title: worker.title,
                    })
                  }
                >
                  {row}
                </button>
              );
            })()}
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
      {modal === 'review' && (
        <ReviewInbox
          workers={workers}
          reviews={reviews}
          commands={commands}
          error={reviewError}
          incomplete={reviewLoading || workerError}
          targets={targets}
          onClose={() => setModal(undefined)}
        />
      )}
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
            {past.map((ticket) => (
              <li key={`${ticket.gameId}:${ticket.ticket}`}>
                <button
                  type="button"
                  onClick={() => {
                    setModal(undefined);
                    setDetail(ticket);
                  }}
                >
                  {ticket.title} · {ticket.outcome}
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      {detail && (
        <TicketDetail
          gameId={detail.gameId}
          ticket={detail.ticket}
          title={detail.title}
          creatorId={creatorId}
          onClose={() => setDetail(undefined)}
          onConversation={(() => {
            const target = conversationOf(detail, jobs);
            if (!target) return undefined;
            return () => {
              setDetail(undefined);
              if (typeof target === 'string') openConversation(target);
              else setConversation(target);
            };
          })()}
        />
      )}
      {conversation && (
        <TicketConversation creatorId={creatorId} ticket={conversation} onClose={() => setConversation(undefined)} />
      )}
    </section>
  );
}

type DetailTarget = { gameId: string; ticket: string; title: string } | PastTicket;

// A ticket's conversation from its detail: its job's build chat when a job filed it, else a closed ticket's
// creator-visible discussion. A running ticket no job owns has none.
function conversationOf(target: DetailTarget, jobs: readonly Job[]): string | PastTicket | undefined {
  const past = 'outcome' in target ? target : undefined;
  const job =
    (past?.jobId ? jobs.find((item) => item.id === past.jobId) : undefined) ??
    jobs.find((item) => item.gameId === target.gameId && String(item.aiurIssueNumber) === target.ticket);
  return job?.id ?? past;
}

export function missingReviewTargets(
  workers: readonly WorkerBuild[],
  reviews: readonly WorkerReview[],
  commands: readonly ReviewCommand[],
) {
  return workers.flatMap((worker) => {
    if (worker.state !== 'human-review') return [];
    const separator = worker.ticket.lastIndexOf(':');
    if (separator < 0) return [];
    const gameId = worker.ticket.slice(0, separator);
    const ticket = worker.ticket.slice(separator + 1);
    if (
      reviews.some(
        (review) =>
          review.gameId === gameId &&
          (review.kind === 'standalone-preview' ? review.preview.ticket : review.round.ticket) === ticket,
      ) ||
      commands.some((command) => commandSource(command) === gameId && command.ticket === ticket)
    )
      return [];
    return [{ gameId, ticket, title: worker.title }];
  });
}

function waitingLabel(state?: string): string | undefined {
  return (
    { 'human-review': 'Needs review', 'ci-wait': 'Waiting for checks', merging: 'Merging' } as Record<string, string>
  )[state ?? ''];
}
