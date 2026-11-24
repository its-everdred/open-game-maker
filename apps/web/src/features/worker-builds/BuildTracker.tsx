import { useEffect, useId, useRef, useState } from 'react';
import type { Job } from '@ogm/contracts';
import { commandSource, targetSource, type ReviewCommand, type ReviewTarget } from './review-command';
import { Icon } from '../../components/Icon';
import { MenuRing } from '../../components/MenuCircle';
import { Dialog } from '../../components/Dialog';
import { ReviewInbox } from './ReviewInbox';
import { openConversation } from '../build-chat/conversation';
import { TicketConversation } from './TicketConversation';
import { TicketDetail } from './TicketDetail';
import type { PastTicket } from './usePastTickets';
import type { ConversationTarget } from './TicketConversation';
import type { WorkerReview } from './useWorkerReviews';
import type { FinishedWorker } from './useWorkerFinishes';
import { readUpdates, useNotify, type Update } from '../../lib/notify/slice';
import './build-tracker.css';

const EMPTY_UPDATES: readonly Update[] = [];

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
  finished?: readonly FinishedWorker[];
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
  const trackerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (event.target instanceof Node && !trackerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const [acknowledged, setAcknowledged] = useState<readonly FinishedWorker[]>([]);
  const unreadUpdates = useNotify((state) => (state.updateOwner === creatorId ? state.unreadUpdates : 0));
  const hasUpdates = useNotify((state) => state.updateOwner === creatorId && state.updates.length > 0);
  const id = useId();
  if (
    !hasUpdates &&
    !acknowledged.length &&
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
    !open
  )
    return null;
  const missingTargets = [...missingReviewTargets(workers, reviews, commands), ...coreTargets];
  const pending = reviews.length + commands.length;
  const count = workers.length
    ? `${workers.length} ${workers.length === 1 ? 'build' : 'builds'} running`
    : pending
      ? `${pending} builds to review`
      : 'Completed builds';
  return (
    <div className="worker-tracker" ref={trackerRef}>
      <button
        type="button"
        className="worker-tracker-button"
        aria-label={
          unreadUpdates ? `${count}, ${unreadUpdates} new ${unreadUpdates === 1 ? 'update' : 'updates'}` : count
        }
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (finished.length) setAcknowledged((prior) => [...prior, ...finished]);
          onDismiss?.();
          readUpdates();
          setOpen(!open);
        }}
      >
        <MenuRing percent={workers.length ? (combinedPercent(workers) ?? undefined) : undefined} />
        <Icon name="hammer" />
        <span className="worker-tracker-count" aria-hidden="true">
          {pending +
            missingTargets.length +
            finished.length +
            workers.filter((worker) => worker.state !== 'human-review').length +
            unreadUpdates || '✓'}
        </span>
      </button>
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
          finished={[...acknowledged, ...finished]}
          id={id}
          onClose={() => setOpen(false)}
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
  finished = [],
  id,
  gameId,
  onClose,
}: PanelProps & { id: string; gameId?: string; onClose?(): void }) {
  const allUpdates = useNotify((state) => (state.updateOwner === creatorId ? state.updates : EMPTY_UPDATES));
  const updates = gameId === undefined ? allUpdates : allUpdates.filter((update) => update.gameId === gameId);
  const [modal, setModal] = useState<'review' | 'completed' | undefined>();
  const [filtered, setFiltered] = useState(false);
  const [selectedReview, setSelectedReview] = useState<WorkerReview>();
  const [selectedCommand, setSelectedCommand] = useState<ReviewCommand>();
  const [selectedTarget, setSelectedTarget] = useState<ReviewTarget>();
  const [expandedWorker, setExpandedWorker] = useState<string>();
  const [conversation, setConversation] = useState<ConversationTarget>();
  const [detail, setDetail] = useState<DetailTarget>();
  const missingTargets = missingReviewTargets(workers, reviews, commands);
  const reviewCount = reviews.length + commands.length + missingTargets.length + coreTargets.length;
  return (
    <section className="worker-tracker-panel" id={id} aria-label="Builds">
      <div className="worker-tracker-heading">
        <h2>Builds</h2>
        {onClose && (
          <button type="button" className="worker-tracker-close" aria-label="Close builds" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      {finished.length > 0 && (
        <ul>
          {finished.map((item) => (
            <li key={item.ticket}>{item.title} is ready</li>
          ))}
        </ul>
      )}
      {updates.length > 0 && (
        <ul>
          {updates.map((update) => (
            <li key={update.id}>{update.text}</li>
          ))}
        </ul>
      )}
      {reviewError && <p role="alert">Could not load all reviews.</p>}
      {reviewCount > 0 && (
        <button
          type="button"
          className="worker-tracker-summary"
          aria-expanded={filtered}
          onClick={() => setFiltered(!filtered)}
        >
          {reviewCount} need review
        </button>
      )}
      <ul className="worker-tracker-list">
        {filtered &&
          reviews.map((review) => {
            const ticket = review.kind === 'standalone-preview' ? review.preview.ticket : review.round.ticket;
            const title =
              workers.find((worker) => worker.ticket === `${review.gameId}:${ticket}`)?.title ??
              (review.kind === 'standalone-preview' ? `Build #${ticket}` : review.round.question || `Build #${ticket}`);
            return (
              <li
                className="worker-review-group-item"
                key={`${review.gameId}:${review.kind}:${review.kind === 'standalone-preview' ? review.preview.buildId : review.round.id}`}
              >
                <button
                  type="button"
                  aria-label={reviewRowLabel(
                    title,
                    workers.find((worker) => worker.ticket === `${review.gameId}:${ticket}`),
                  )}
                  onClick={() => {
                    setSelectedReview(review);
                    setSelectedCommand(undefined);
                    setSelectedTarget(undefined);
                    setModal('review');
                  }}
                >
                  {title}
                  <ProgressBar
                    worker={workers.find((worker) => worker.ticket === `${review.gameId}:${ticket}`)}
                    label="Needs review"
                  />
                </button>
              </li>
            );
          })}
        {filtered &&
          commands.map((command) => (
            <li className="worker-review-group-item" key={`${commandSource(command)}:${command.decision_id}`}>
              <button
                type="button"
                aria-label={reviewRowLabel(
                  command.summary || command.title,
                  workers.find((worker) => worker.ticket === `${commandSource(command)}:${command.ticket}`),
                )}
                onClick={() => {
                  setSelectedCommand(command);
                  setSelectedReview(undefined);
                  setSelectedTarget(undefined);
                  setModal('review');
                }}
              >
                {command.summary || command.title}
                <ProgressBar
                  worker={workers.find((worker) => worker.ticket === `${commandSource(command)}:${command.ticket}`)}
                  label="Needs review"
                />
              </button>
            </li>
          ))}
        {filtered &&
          [...missingTargets, ...coreTargets].map((target) => (
            <li className="worker-review-group-item" key={`${targetSource(target)}:${target.ticket}`}>
              <button
                type="button"
                aria-label={reviewRowLabel(
                  target.title,
                  workers.find((worker) => worker.ticket === `${targetSource(target)}:${target.ticket}`),
                )}
                onClick={() => {
                  setSelectedTarget(target);
                  setSelectedReview(undefined);
                  setSelectedCommand(undefined);
                  setModal('review');
                }}
              >
                {target.title}
                <ProgressBar
                  worker={workers.find((worker) => worker.ticket === `${targetSource(target)}:${target.ticket}`)}
                  label="Needs review"
                />
              </button>
            </li>
          ))}
        {workers
          .filter((worker) => worker.state !== 'human-review')
          .map((worker) => (
            <li key={worker.ticket}>
              <WorkerRow
                worker={worker}
                expanded={expandedWorker === worker.ticket}
                onToggle={() => setExpandedWorker(expandedWorker === worker.ticket ? undefined : worker.ticket)}
              />
              {expandedWorker === worker.ticket && splitTicket(worker.ticket) && (
                <button
                  type="button"
                  onClick={() => setDetail({ ...splitTicket(worker.ticket)!, title: worker.title })}
                >
                  Details
                </button>
              )}
              {expandedWorker === worker.ticket && !splitTicket(worker.ticket) && (
                <small>{worker.percent == null ? 'Progress unavailable' : `${worker.percent}% complete`}</small>
              )}
              <ProgressBar
                worker={worker}
                label={waitingLabel(worker.state) ?? (worker.percent == null ? 'In progress' : `${worker.percent}%`)}
              />
              {expandedWorker === worker.ticket &&
                (worker.phase || worker.elapsedSeconds != null) &&
                !waitingLabel(worker.state) && (
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
          initialReview={selectedReview}
          initialCommand={selectedCommand}
          initialTarget={selectedTarget}
          error={reviewError}
          incomplete={reviewLoading || workerError}
          targets={
            selectedTarget
              ? [...missingTargets, ...coreTargets].filter(
                  (target) =>
                    targetSource(target) === targetSource(selectedTarget) && target.ticket === selectedTarget.ticket,
                )
              : []
          }
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
          onConversation={() => {
            const talk = conversationOf(detail, jobs);
            setDetail(undefined);
            if (typeof talk === 'string') openConversation(talk);
            else setConversation(talk);
          }}
        />
      )}
      {conversation && (
        <TicketConversation creatorId={creatorId} ticket={conversation} onClose={() => setConversation(undefined)} />
      )}
    </section>
  );
}

type DetailTarget = { gameId: string; ticket: string; title: string } | PastTicket;

// A worker's ticket is `<gameId>:<ticket>`; one without its game has no detail to open.
function splitTicket(ticket: string): { gameId: string; ticket: string } | undefined {
  const separator = ticket.lastIndexOf(':');
  return separator < 0 ? undefined : { gameId: ticket.slice(0, separator), ticket: ticket.slice(separator + 1) };
}

function WorkerRow({ worker, expanded, onToggle }: { worker: WorkerBuild; expanded: boolean; onToggle(): void }) {
  return (
    <button type="button" className="worker-tracker-row" aria-expanded={expanded} onClick={onToggle}>
      <strong>{worker.title}</strong>
    </button>
  );
}

// A ticket's conversation from its detail: its job's build chat when a job filed it, else the ticket's own
// creator-visible discussion, running or closed.
function conversationOf(target: DetailTarget, jobs: readonly Job[]): string | ConversationTarget {
  const past = 'outcome' in target ? target : undefined;
  const job =
    (past?.jobId ? jobs.find((item) => item.id === past.jobId) : undefined) ??
    jobs.find((item) => item.gameId === target.gameId && String(item.aiurIssueNumber) === target.ticket);
  return job?.id ?? target;
}

export function missingReviewTargets(
  workers: readonly WorkerBuild[],
  reviews: readonly WorkerReview[],
  commands: readonly ReviewCommand[],
) {
  return workers.flatMap((worker) => {
    if (worker.state !== 'human-review') return [];
    const target = splitTicket(worker.ticket);
    if (!target) return [];
    const { gameId, ticket } = target;
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

function ProgressBar({ worker, label }: { worker?: WorkerBuild; label: string }) {
  const percent = worker?.percent;
  return (
    <span
      className="worker-tracker-bar"
      role="progressbar"
      aria-label={`${worker?.title ?? label} progress`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={percent == null ? 'Progress unavailable' : undefined}
    >
      <span
        className={percent == null ? 'worker-tracker-indeterminate' : undefined}
        style={{ width: `${percent ?? 30}%` }}
      />
      <span className="worker-tracker-bar-label">{label}</span>
    </span>
  );
}

function reviewRowLabel(title: string, worker?: WorkerBuild): string {
  return `${title}, Needs review, ${worker?.percent == null ? 'progress unavailable' : `${worker.percent}%`}`;
}
