import { useEffect, useState } from 'react';
import {
  commandPath,
  commandSource,
  commandTitle,
  targetPath,
  targetSource,
  type ReviewCommand,
  type ReviewTarget,
} from './review-command';
import { Dialog } from '../../components/Dialog';
import { CommandReviewCard } from './CommandReviewCard';
import { MissingMedia } from './MissingMedia';
import { PreviewCard } from '../../routes/review/PreviewReviews';
import { RoundCard } from '../../routes/review/RoundReviews';
import type { WorkerReview } from './useWorkerReviews';
import type { WorkerBuild } from './BuildTracker';
import '../build-chat/conversation-modal.css';
import '../commands-inbox/review-deck.css';
import '../commands-inbox/decision-deck.css';

export function ReviewInbox({
  reviews,
  commands,
  onClose,
  targets = [],
  workers = [],
  error = false,
}: {
  reviews: readonly WorkerReview[];
  commands: readonly ReviewCommand[];
  onClose(): void;
  targets?: readonly ReviewTarget[];
  workers?: readonly WorkerBuild[];
  error?: boolean;
}) {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [answeredTickets, setAnsweredTickets] = useState<ReadonlySet<string>>(() => new Set());
  const [current, setCurrent] = useState<WorkerReview | undefined>();
  const [command, setCommand] = useState<ReviewCommand | undefined>();
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<(typeof targets)[number] | undefined>();
  useEffect(() => {
    if (current?.kind !== 'round' || !current.round.buildId) return;
    const recovered = reviews.find(
      (review) => review.kind === 'preview' && review.gameId === current.gameId && review.round.id === current.round.id,
    );
    if (recovered) setCurrent(recovered);
  }, [current, reviews]);
  if (target) {
    return (
      <Dialog
        title="Needs Review"
        className="job-conversation-dialog build-review-dialog"
        backdropClassName="job-conversation-backdrop"
        onClose={() => setTarget(undefined)}
      >
        <p>{target.title}</p>
        <MissingMedia path={targetPath(target)} />
        <button type="button" onClick={() => setTarget(undefined)}>
          Back
        </button>
      </Dialog>
    );
  }
  if (command && 'source' in command && command.options.some((option) => option.playable)) {
    return (
      <Dialog
        title="Needs Review"
        className="job-conversation-dialog build-review-dialog"
        backdropClassName="job-conversation-backdrop"
        onClose={() => setCommand(undefined)}
      >
        <p role="alert">The playable preview is unavailable.</p>
        <button type="button" onClick={() => setCommand(undefined)}>
          Back
        </button>
      </Dialog>
    );
  }
  if (command && command.options.every(({ media, audio, playable }) => media || audio || playable)) {
    return (
      <Dialog
        title="Needs Review"
        className="job-conversation-dialog decision-deck build-review-dialog"
        backdropClassName="job-conversation-backdrop"
        onClose={() => {
          if (!sending) onClose();
        }}
      >
        <div className="decision-deck-body">
          {error && <p role="alert">Could not load all reviews.</p>}
          <button type="button" disabled={sending} onClick={() => setCommand(undefined)}>
            Back
          </button>
          <CommandReviewCard
            command={command}
            onSendingChange={setSending}
            ticketState={
              workers.find((worker) => worker.ticket === `${commandSource(command)}:${command.ticket}`)?.state
            }
            onAnswered={() => {
              setAnswered((seen) => new Set(seen).add(`command:${commandSource(command)}:${command.decision_id}`));
              if (command.ticket)
                setAnsweredTickets((seen) => new Set(seen).add(`${commandSource(command)}:${command.ticket}`));
            }}
          />
        </div>
      </Dialog>
    );
  }
  if (command) {
    return (
      <Dialog
        title="Needs Review"
        className="job-conversation-dialog build-review-dialog"
        backdropClassName="job-conversation-backdrop"
        onClose={() => setCommand(undefined)}
      >
        <MissingMedia path={`${commandPath(command)}/${encodeURIComponent(command.decision_id)}/missing-media`} />
        <button type="button" onClick={() => setCommand(undefined)}>
          Back
        </button>
      </Dialog>
    );
  }
  if (!current) {
    return (
      <Dialog
        title="Needs Review"
        className="job-conversation-dialog decision-deck build-review-dialog"
        backdropClassName="job-conversation-backdrop"
        onClose={onClose}
      >
        <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="decision-deck-body">
          {error && <p role="alert">Could not load all reviews.</p>}
          {reviews
            .filter((review) => !answered.has(keyOf(review)))
            .map((review) => (
              <div key={keyOf(review)}>
                <button type="button" className="worker-review-item" onClick={() => setCurrent(review)}>
                  {review.gameTitle ? `${review.gameTitle} · ` : ''}
                  {review.kind === 'standalone-preview'
                    ? review.preview.question || review.preview.title || `Ticket ${review.preview.ticket}`
                    : review.round.question || `Ticket ${review.round.ticket}`}
                </button>
                {review.kind === 'round' && review.round.media.length === 0 && !review.round.buildId && (
                  <MissingMedia
                    path={`/games/${encodeURIComponent(review.gameId)}/review-rounds/${encodeURIComponent(review.round.id)}/missing-media`}
                  />
                )}
              </div>
            ))}
          {targets
            .filter((item) => !answeredTickets.has(`${targetSource(item)}:${item.ticket}`))
            .map((item) => (
              <div key={`${targetSource(item)}:${item.ticket}`}>
                <button type="button" className="worker-review-item" onClick={() => setTarget(item)}>
                  {'source' in item ? 'Core · ' : ''}
                  {item.title}
                </button>
                <MissingMedia path={targetPath(item)} />
              </div>
            ))}
          {commands
            .filter((item) => !answered.has(`command:${commandSource(item)}:${item.decision_id}`))
            .map((item) => (
              <div key={`${commandSource(item)}:${item.decision_id}`}>
                <button type="button" className="worker-review-item" onClick={() => setCommand(item)}>
                  {commandTitle(item)} · {item.summary ?? item.title}
                </button>
                {!item.options.every(({ media, audio, playable }) => media || audio || playable) && (
                  <MissingMedia path={`${commandPath(item)}/${encodeURIComponent(item.decision_id)}/missing-media`} />
                )}
              </div>
            ))}
          {!error && reviews.length === 0 && commands.length === 0 && targets.length === 0 && (
            <p>All reviews answered.</p>
          )}
        </div>
      </Dialog>
    );
  }
  const done = () => {
    const seen = new Set(answered).add(keyOf(current));
    setAnswered(seen);
    const ticket = current.kind === 'standalone-preview' ? current.preview.ticket : current.round.ticket;
    setAnsweredTickets((previous) => new Set(previous).add(`${current.gameId}:${ticket}`));
  };
  return (
    <Dialog
      title="Needs Review"
      className="job-conversation-dialog decision-deck build-review-dialog"
      backdropClassName="job-conversation-backdrop"
      onClose={onClose}
    >
      <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <div className="decision-deck-body">
        <button type="button" onClick={() => setCurrent(undefined)}>
          Back
        </button>
        {answered.has(keyOf(current)) && (
          <p role="status">
            Ticket state:{' '}
            {workers.find(
              (worker) =>
                worker.ticket ===
                `${current.gameId}:${current.kind === 'standalone-preview' ? current.preview.ticket : current.round.ticket}`,
            )?.state ?? 'updating'}
          </p>
        )}
        {current.kind === 'round' && current.round.media.length === 0 && !current.round.buildId ? (
          <MissingMedia
            path={`/games/${encodeURIComponent(current.gameId)}/review-rounds/${encodeURIComponent(current.round.id)}/missing-media`}
          />
        ) : current.kind === 'round' ? (
          <RoundCard key={keyOf(current)} gameId={current.gameId} round={current.round} onAnswered={done} />
        ) : (
          <div key={keyOf(current)}>
            {(current.kind === 'preview' ? current.round.media : []).map((item) => (
              <div className="review-deck-playable" key={item.url}>
                {item.kind === 'still' ? (
                  <img className="review-deck-media" src={item.url} alt="Review" />
                ) : (
                  <video
                    className="review-deck-media"
                    style={{ pointerEvents: 'auto' }}
                    src={item.url}
                    controls
                    playsInline
                  />
                )}
              </div>
            ))}
            <PreviewCard gameId={current.gameId} preview={current.preview} onAnswered={done} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function keyOf(review: WorkerReview): string {
  return `${review.gameId}:${review.kind}:${review.kind === 'round' ? review.round.id : review.preview.buildId}`;
}
