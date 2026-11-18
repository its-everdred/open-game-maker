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
import { readUpdates, useNotify } from '../../lib/notify/slice';
import './build-tracker.css';

const EMPTY_UPDATES: readonly { id: number; text: string }[] = [];

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
  // With items waiting on the creator, the hammer opens straight on the review deck (#843); the panel sits behind it.
  const [reviewFirst, setReviewFirst] = useState(false);
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
        aria-label={
          unreadUpdates ? `${count}, ${unreadUpdates} new ${unreadUpdates === 1 ? 'update' : 'updates'}` : count
        }
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (finished.length) setAcknowledged((prior) => [...prior, ...finished]);
          onDismiss?.();
          readUpdates();
          setReviewFirst(!open && (pending > 0 || Boolean(reviewLoading)));
          setOpen(!open);
        }}
      >
        <MenuRing percent={workers.length ? (combinedPercent(workers) ?? undefined) : undefined} />
        <Icon name="hammer" />
        <span className="worker-tracker-count" aria-hidden="true">
          {pending +
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
          reviewFirst={reviewFirst}
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
  finished = [],
  reviewFirst,
  id,
}: PanelProps & { id: string; reviewFirst?: boolean }) {
  const updates = useNotify((state) => (state.updateOwner === creatorId ? state.updates : EMPTY_UPDATES));
  const [modal, setModal] = useState<'review' | 'completed' | undefined>();
  const [deckFirst, setDeckFirst] = useState(reviewFirst);
  const [conversation, setConversation] = useState<PastTicket>();
  const [detail, setDetail] = useState<DetailTarget>();
  const targets = [...missingReviewTargets(workers, reviews, commands), ...coreTargets];
  const reviewCount = reviews.length + commands.length + targets.length;
  // Opened deck-first: the deck shows once the reviews are known, unless the creator picked something else first.
  if (deckFirst && !modal && !detail && reviewCount > 0) {
    setDeckFirst(false);
    setModal('review');
  } else if (deckFirst && (modal || detail || !reviewLoading)) setDeckFirst(false);
  const talk = detail && conversationOf(detail, jobs);
  return (
    <section className="worker-tracker-panel" id={id} aria-label="Builds">
      <h2>Builds</h2>
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
            <WorkerRow worker={worker} onOpen={setDetail} />
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
          onConversation={
            talk === undefined
              ? undefined
              : () => {
                  setDetail(undefined);
                  if (typeof talk === 'string') openConversation(talk);
                  else setConversation(talk);
                }
          }
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

function WorkerRow({ worker, onOpen }: { worker: WorkerBuild; onOpen(target: DetailTarget): void }) {
  const row = (
    <>
      <strong>{worker.title}</strong>
      <span>
        {waitingLabel(worker.state) ??
          (worker.percent === 100 ? 'Finishing' : worker.percent == null ? '' : `${worker.percent}%`)}
      </span>
    </>
  );
  const target = splitTicket(worker.ticket);
  return target ? (
    <button type="button" className="worker-tracker-row" onClick={() => onOpen({ ...target, title: worker.title })}>
      {row}
    </button>
  ) : (
    <div>{row}</div>
  );
}

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
