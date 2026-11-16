import { useId, useState } from 'react';
import type { CreatorCommand, Job } from '@ogm/contracts';
import { Icon } from '../../components/Icon';
import { MenuRing } from '../../components/MenuCircle';
import { Dialog } from '../../components/Dialog';
import { ReviewInbox } from './ReviewInbox';
import { openConversation } from '../build-chat/conversation';
import { TicketConversation } from './TicketConversation';
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
  reviewError?: boolean;
  workerError?: boolean;
  creatorId?: string;
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
  reviewError,
  workerError,
  creatorId,
  jobs = [],
  onDismiss,
}: PanelProps & {
  finished?: readonly FinishedWorker[];
  onDismiss?(): void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (
    !open &&
    !workers.length &&
    !finished.length &&
    !reviews.length &&
    !commands.length &&
    !past.length &&
    !historyError &&
    !historyLoading &&
    !workerError &&
    !reviewError
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
          creatorId={creatorId}
          workerError={workerError}
          reviewError={reviewError}
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
  reviewError,
  workerError,
  creatorId,
  jobs = [],
  id,
}: PanelProps & { id: string }) {
  const [modal, setModal] = useState<'completed'>();
  const [conversation, setConversation] = useState<PastTicket>();
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<string>();
  const [detail, setDetail] = useState<WorkerBuild>();
  const groups = new Map<string, { worker?: WorkerBuild; reviews: WorkerReview[]; commands: CreatorCommand[] }>();
  const group = (key: string) => {
    let entry = groups.get(key);
    if (!entry) {
      entry = { reviews: [], commands: [] };
      groups.set(key, entry);
    }
    return entry;
  };
  for (const worker of workers.filter((item) => item.state === 'human-review')) group(worker.ticket).worker = worker;
  for (const review of reviews) group(`${review.gameId}:${review.round.ticket}`).reviews.push(review);
  for (const command of commands)
    group(`${command.game_id}:${command.ticket ?? `command:${command.command_id}`}`).commands.push(command);
  for (const worker of workers) {
    const entry = groups.get(worker.ticket);
    if (entry) entry.worker = worker;
  }
  const reviewCount = groups.size;
  const activeDetail = detail && workers.find((worker) => worker.ticket === detail.ticket);
  const openWorker = (worker: WorkerBuild) => setDetail(worker);
  const detailJob = detail && jobs.find((item) => `${item.gameId}:${item.aiurIssueNumber}` === detail.ticket);
  return (
    <section className="worker-tracker-panel" id={id} aria-label="Builds">
      <h2>Builds</h2>
      {workerError && <p role="alert">Could not load all build updates.</p>}
      {reviewError && <p role="alert">Could not load all reviews.</p>}
      {reviewCount > 0 && (
        <button
          type="button"
          className="worker-tracker-summary"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          Needs review · {reviewCount}
        </button>
      )}
      <ul className="worker-tracker-list">
        {expanded &&
          [...groups.entries()].map(([key, entry]) => {
            const review = entry.reviews[0];
            const command = entry.commands[0];
            const worker = entry.worker ?? {
              ticket: key,
              title: review?.round.question || command?.summary || command?.title || `Build #${review?.round.ticket}`,
              state: 'human-review',
              percent: null,
              etaSeconds: null,
            };
            return (
              <WorkerRow
                key={key}
                worker={worker}
                review
                onClick={() => {
                  if (entry.reviews.length || entry.commands.length) setSelection(key);
                  else openWorker(worker);
                }}
              />
            );
          })}
        {workers
          .filter((worker) => !groups.has(worker.ticket))
          .map((worker) => (
            <WorkerRow key={worker.ticket} worker={worker} onClick={() => openWorker(worker)} />
          ))}
        <li>
          <button type="button" onClick={() => setModal('completed')}>
            Completed
          </button>
        </li>
      </ul>
      {selection && (
        <ReviewInbox
          reviews={groups.get(selection)?.reviews ?? []}
          commands={groups.get(selection)?.commands ?? []}
          onClose={() => setSelection(undefined)}
        />
      )}
      {detail && (
        <Dialog
          title={detail.title}
          className="job-conversation-dialog"
          backdropClassName="job-conversation-backdrop"
          onClose={() => setDetail(undefined)}
        >
          <p>
            {activeDetail
              ? (waitingLabel(activeDetail.state) ?? activeDetail.phase ?? 'Build in progress')
              : workerError
                ? 'Could not load build updates'
                : 'Build no longer active'}
          </p>
          {activeDetail && <p>{activeDetail.percent == null ? 'Progress unavailable' : `${activeDetail.percent}%`}</p>}
          {detailJob && (
            <button
              type="button"
              onClick={() => {
                setDetail(undefined);
                openConversation(detailJob.id);
              }}
            >
              Conversation
            </button>
          )}
          <button type="button" onClick={() => setDetail(undefined)}>
            Close
          </button>
        </Dialog>
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
            {past.map((ticket) => {
              const job =
                jobs.find((item) => item.id === ticket.jobId) ??
                jobs.find((item) => item.gameId === ticket.gameId && String(item.aiurIssueNumber) === ticket.ticket);
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
                    <button
                      type="button"
                      onClick={() => {
                        setModal(undefined);
                        setConversation(ticket);
                      }}
                    >
                      {ticket.title} · {ticket.outcome}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Dialog>
      )}
      {conversation && (
        <TicketConversation creatorId={creatorId} ticket={conversation} onClose={() => setConversation(undefined)} />
      )}
    </section>
  );
}

function waitingLabel(state?: string): string | undefined {
  return (
    { 'human-review': 'Waiting for review', 'ci-wait': 'Waiting for checks', merging: 'Merging' } as Record<
      string,
      string
    >
  )[state ?? ''];
}

function WorkerRow({ worker, onClick, review }: { worker: WorkerBuild; onClick(): void; review?: boolean }) {
  const label =
    (review ? 'Needs review' : waitingLabel(worker.state)) ??
    (worker.percent === 100 ? 'Finishing' : worker.percent == null ? 'In progress' : `${worker.percent}%`);
  return (
    <li>
      <button type="button" onClick={onClick}>
        <span className="worker-tracker-row-heading">
          <strong>{worker.title}</strong>
        </span>
        <span
          className="worker-tracker-bar"
          role="progressbar"
          aria-label={`${worker.title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={worker.percent ?? undefined}
          aria-valuetext={worker.percent == null ? 'Progress unavailable' : undefined}
        >
          <span
            className={worker.percent == null ? 'worker-tracker-indeterminate' : undefined}
            style={{ width: `${worker.percent ?? 30}%` }}
          />
          <span className="worker-tracker-bar-label">{label}</span>
        </span>
        {(worker.phase || (worker.elapsedSeconds != null && worker.elapsedSeconds > 0)) && (
          <small>
            {[
              worker.phase,
              worker.elapsedSeconds
                ? `${Math.floor(worker.elapsedSeconds / 60)}m ${worker.elapsedSeconds % 60}s elapsed`
                : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        )}
      </button>
    </li>
  );
}
