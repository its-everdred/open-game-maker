import { useEffect, useState } from 'react';
import {
  commandPath,
  commandSource,
  targetPath,
  targetSource,
  type ReviewCommand,
  type ReviewTarget,
} from './review-command';
import { Dialog } from '../../components/Dialog';
import { CommandReviewCard } from './CommandReviewCard';
import { MissingMediaStatus, useMissingMedia } from './MissingMedia';
import { PreviewCard } from '../../routes/review/PreviewReviews';
import { RoundCard } from '../../routes/review/RoundReviews';
import type { WorkerReview } from './useWorkerReviews';
import { useAnsweredReviews, type AnsweredCommand, type SessionAnsweredCommand } from './useAnsweredReviews';
import type { WorkerBuild } from './BuildTracker';
import '../build-chat/conversation-modal.css';
import '../commands-inbox/review-deck.css';
import '../commands-inbox/review-glass.css';
import './review-inbox.css';
import '../commands-inbox/decision-deck.css';

export function ReviewInbox({
  reviews,
  commands,
  onClose,
  targets = [],
  workers = [],
  error = false,
  incomplete = false,
  initialReview,
  initialCommand,
  initialTarget,
}: {
  reviews: readonly WorkerReview[];
  commands: readonly ReviewCommand[];
  onClose(): void;
  targets?: readonly ReviewTarget[];
  workers?: readonly WorkerBuild[];
  error?: boolean;
  incomplete?: boolean;
  initialReview?: WorkerReview;
  initialCommand?: ReviewCommand;
  initialTarget?: ReviewTarget;
}) {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [answeredTickets, setAnsweredTickets] = useState<ReadonlySet<string>>(() => new Set());
  const [current, setCurrent] = useState<WorkerReview | undefined>(initialReview);
  const [newReviewKeys, setNewReviewKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [newCommandKeys, setNewCommandKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [command, setCommand] = useState<ReviewCommand | undefined>(initialCommand);
  const [sessionSavedCommand, setSessionSavedCommand] = useState<SessionAnsweredCommand>();
  const [savedCommand, setSavedCommand] = useState<AnsweredCommand>();
  const [sending, setSending] = useState(false);
  const busy = sending;
  const [target, setTarget] = useState<ReviewTarget | undefined>(initialTarget);
  const answeredReviewData = useAnsweredReviews(reviews, commands);
  const { savedCommands, sessionAnsweredCommands, rememberCommand } = answeredReviewData;
  const answeredReviews = reviews.filter((review) => answered.has(keyOf(review)));
  const answeredCommands = commands.filter((item) => answered.has(commandKey(item)));
  const pendingReviews = reviews.filter((review) => !answered.has(keyOf(review)));
  const pendingCommands = commands.filter((item) => !answered.has(commandKey(item)));
  const pendingTargets = targets.filter((item) => !answeredTickets.has(`${targetSource(item)}:${item.ticket}`));
  const queue = [
    ...pendingReviews.map((item) => ({ kind: 'review' as const, item, key: keyOf(item) })),
    ...pendingCommands.map((item) => ({
      kind: 'command' as const,
      item,
      key: commandKey(item),
    })),
    ...pendingTargets.map((item) => ({
      kind: 'target' as const,
      item,
      key: `target:${targetSource(item)}:${item.ticket}`,
    })),
  ];
  const answerRows = [
    ...answeredReviews.map((item) => ({ kind: 'review' as const, item, key: `answered-review:${keyOf(item)}` })),
    ...answeredCommands.map((item) => ({ kind: 'command' as const, item, key: commandKey(item) })),
    ...savedCommands
      .filter(
        (item) =>
          !answeredCommands.some(
            (command) => commandSource(command) === item.gameId && command.decision_id === item.review.decision_id,
          ),
      )
      .map((item) => ({ kind: 'saved-command' as const, item, key: `saved-command:${item.review.id}` })),
    ...sessionAnsweredCommands
      .filter(
        ({ command: item }) =>
          !answeredCommands.some(
            (answeredCommand) =>
              commandSource(answeredCommand) === commandSource(item) &&
              answeredCommand.decision_id === item.decision_id,
          ) &&
          !savedCommands.some(
            (saved) => saved.gameId === commandSource(item) && saved.review.decision_id === item.decision_id,
          ),
      )
      .map((item) => ({
        kind: 'session-command' as const,
        item,
        key: `session-command:${commandSource(item.command)}:${item.command.decision_id}`,
      })),
  ];
  const missingPaths = [
    ...pendingReviews.flatMap((review) =>
      review.kind === 'round' &&
      review.round.track !== 'prototype-publish' &&
      ((!review.round.media.some((item) => item.role !== 'target') && !review.round.buildId) ||
        Boolean(review.round.buildId))
        ? [
            `/games/${encodeURIComponent(review.gameId)}/review-rounds/${encodeURIComponent(review.round.id)}/missing-media${review.round.buildId ? '?kind=build' : ''}`,
          ]
        : [],
    ),
    ...pendingCommands.flatMap((item) =>
      item.options.every(({ media, audio, audioClips, playable }) => media || audio || audioClips?.length || playable)
        ? []
        : [commandPath(item, `/${encodeURIComponent(item.decision_id)}/missing-media`)],
    ),
    ...pendingTargets.map(targetPath),
  ];
  const missing = useMissingMedia(missingPaths);
  const missingStatus = (path: string) => (
    <MissingMediaStatus status={missing.statuses[path]} onRetry={() => missing.retry(path)} />
  );
  const activeKey = current
    ? keyOf(current)
    : command
      ? commandKey(command)
      : target
        ? `target:${targetSource(target)}:${target.ticket}`
        : undefined;
  const show = (entry: (typeof queue)[number] | (typeof answerRows)[number] | undefined) => {
    setCurrent(entry?.kind === 'review' ? entry.item : undefined);
    setCommand(
      entry?.kind === 'command'
        ? entry.item
        : entry?.kind === 'saved-command'
          ? commands.find(
              (item) => commandSource(item) === entry.item.gameId && item.decision_id === entry.item.review.decision_id,
            )
          : entry?.kind === 'session-command'
            ? commands.find(
                (item) =>
                  commandSource(item) === commandSource(entry.item.command) &&
                  item.decision_id === entry.item.command.decision_id,
              )
            : undefined,
    );
    setSavedCommand(entry?.kind === 'saved-command' ? entry.item : undefined);
    setSessionSavedCommand(entry?.kind === 'session-command' ? entry.item : undefined);
    setTarget(entry?.kind === 'target' ? entry.item : undefined);
  };
  const next = () => {
    const index = queue.findIndex((entry) => entry.key === activeKey);
    show(queue[index < 0 ? 0 : (index + 1) % queue.length]);
  };
  useEffect(() => {
    if (!activeKey && queue.length) show(queue[0]);
  });
  const queueControls = (
    <div className="worker-review-queue">
      <p aria-live="polite">{queue.length} left</p>
      {(queue.length > 1 || (activeKey && !queue.some((entry) => entry.key === activeKey))) && (
        <button type="button" className="worker-review-next" disabled={busy} onClick={next}>
          Next
        </button>
      )}
    </div>
  );
  const collapsedAnswers = answerRows.length ? (
    <section className="worker-review-answers" aria-label="Answered reviews">
      {answerRows.map((entry) => {
        const title =
          entry.kind === 'saved-command'
            ? entry.item.review.title
            : entry.kind === 'session-command'
              ? entry.item.command.title
              : entry.kind === 'command'
                ? entry.item.title
                : entry.item.kind === 'standalone-preview'
                  ? (entry.item.preview.title ?? `Ticket ${entry.item.preview.ticket}`)
                  : (entry.item.round.question ?? `Ticket ${entry.item.round.ticket}`);
        const answer =
          entry.kind === 'saved-command'
            ? `${entry.item.review.likes.map(({ label }) => `Liked ${label}`).join(', ')}${entry.item.review.dislikes.length ? ` · disliked ${entry.item.review.dislikes.map(({ label, reason }) => `${label}${reason ? `: ${reason}` : ''}`).join(', ')}` : ''}${entry.item.review.notes ? ` · ${entry.item.review.notes}` : ''}`
            : entry.kind === 'review'
              ? 'Answered in this session'
              : entry.kind === 'session-command'
                ? 'Answer saved in this session'
                : 'Answer saved in this session';
        return (
          <button type="button" className="worker-review-answered" key={entry.key} onClick={() => show(entry)}>
            <strong>{title}</strong>
            <span>{answer}</span>
          </button>
        );
      })}
    </section>
  ) : null;
  useEffect(() => {
    if (sending) return;
    if (current && !answered.has(keyOf(current))) {
      const ticket = current.kind === 'standalone-preview' ? current.preview.ticket : current.round.ticket;
      const replacement =
        reviews.find((review) => keyOf(review) === keyOf(current)) ??
        reviews.find(
          (review) =>
            review.gameId === current.gameId &&
            (review.kind === 'standalone-preview' ? review.preview.ticket : review.round.ticket) === ticket,
        );
      if (!replacement) {
        if (!incomplete && !error) show(queue[0]);
      } else if (
        replacement.kind !== current.kind ||
        (replacement.kind !== 'standalone-preview' &&
          current.kind !== 'standalone-preview' &&
          replacement.round !== current.round) ||
        (replacement.kind !== 'round' && current.kind !== 'round' && replacement.preview !== current.preview)
      ) {
        if (revisionKeyOf(replacement) !== revisionKeyOf(current))
          setNewReviewKeys((seen) => new Set(seen).add(revisionKeyOf(replacement)));
        setCurrent(replacement);
      }
    } else if (command && !answered.has(commandKey(command))) {
      const replacement =
        commands.find(
          (item) => commandSource(item) === commandSource(command) && item.decision_id === command.decision_id,
        ) ??
        (command.ticket
          ? commands.find((item) => commandSource(item) === commandSource(command) && item.ticket === command.ticket)
          : undefined);
      if (!replacement) {
        if (!incomplete && !error) show(queue[0]);
      } else if (replacement !== command) {
        if (commandKey(replacement) !== commandKey(command))
          setNewCommandKeys((seen) => new Set(seen).add(commandKey(replacement)));
        setCommand(replacement);
      }
    } else if (
      target &&
      !targets.some((item) => targetSource(item) === targetSource(target) && item.ticket === target.ticket)
    ) {
      const replacement = queue.find((entry) => {
        if (entry.kind === 'review') {
          const ticket = entry.item.kind === 'standalone-preview' ? entry.item.preview.ticket : entry.item.round.ticket;
          return entry.item.gameId === targetSource(target) && ticket === target.ticket;
        }
        return (
          entry.kind === 'command' &&
          commandSource(entry.item) === targetSource(target) &&
          entry.item.ticket === target.ticket
        );
      });
      if (replacement) show(replacement);
      else if (!incomplete && !error) show(queue[0]);
    }
  });
  if (target) {
    return (
      <Dialog
        title="Needs Review"
        className="job-conversation-dialog build-review-dialog"
        backdropClassName="job-conversation-backdrop"
        onClose={onClose}
      >
        <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {queueControls}
        <p>{target.title}</p>
        {missingStatus(targetPath(target))}
      </Dialog>
    );
  }
  if (command && 'source' in command && command.options.some((option) => option.playable)) {
    return (
      <Dialog
        title="Needs Review"
        className="job-conversation-dialog build-review-dialog"
        backdropClassName="job-conversation-backdrop"
        onClose={onClose}
      >
        <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {queueControls}
        {newCommandKeys.has(commandKey(command)) ? (
          <p className="review-round-new" role="status">
            New round
          </p>
        ) : null}
        <p role="alert">The playable preview is unavailable.</p>
      </Dialog>
    );
  }
  if (
    command &&
    command.options.every(({ media, audio, audioClips, playable }) => media || audio || audioClips?.length || playable)
  ) {
    return (
      <Dialog
        title="Needs Review"
        className="job-conversation-dialog decision-deck build-review-dialog"
        backdropClassName="job-conversation-backdrop"
        onClose={() => {
          if (!busy) onClose();
        }}
      >
        <button type="button" className="job-conversation-close" aria-label="Close" disabled={busy} onClick={onClose}>
          ×
        </button>
        <div className="decision-deck-body">
          {queueControls}
          {collapsedAnswers}
          {newCommandKeys.has(commandKey(command)) ? (
            <p className="review-round-new" role="status">
              New round
            </p>
          ) : null}
          {error && <p role="alert">Could not load all reviews.</p>}
          <CommandReviewCard
            key={`${commandSource(command)}:${command.decision_id}`}
            command={command}
            onSendingChange={setSending}
            ticketState={
              workers.find((worker) => worker.ticket === `${commandSource(command)}:${command.ticket}`)?.state
            }
            onAnswered={() => {
              setAnswered((seen) => new Set(seen).add(commandKey(command)));
              rememberCommand(command);
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
        onClose={onClose}
      >
        <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {queueControls}
        {collapsedAnswers}
        {newCommandKeys.has(commandKey(command)) ? (
          <p className="review-round-new" role="status">
            New round
          </p>
        ) : null}
        {missingStatus(commandPath(command, `/${encodeURIComponent(command.decision_id)}/missing-media`))}
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
        {error ? <p role="alert">Could not load all reviews.</p> : null}
        {collapsedAnswers}
        {savedCommand ? (
          <section className="worker-review-saved">
            <p>{savedCommand.review.question}</p>
            <p>{savedCommand.review.likes.map(({ label }) => `Liked ${label}`).join(', ')}</p>
            {savedCommand.review.dislikes.map(({ label, reason }) => (
              <p key={label}>
                Disliked {label}
                {reason ? `: ${reason}` : ''}
              </p>
            ))}
            {savedCommand.review.notes ? <p>{savedCommand.review.notes}</p> : null}
            <p role="status">The worker already has this answer.</p>
          </section>
        ) : null}
        {sessionSavedCommand ? (
          <section className="worker-review-saved">
            <p>{sessionSavedCommand.command.question}</p>
            <p>Answer saved in this session.</p>
            <p role="status">The worker already has this answer.</p>
          </section>
        ) : null}
        {queue.length === 0 && !error ? <p>All reviews answered.</p> : null}
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
      onClose={() => {
        if (!sending) onClose();
      }}
    >
      <button type="button" className="job-conversation-close" aria-label="Close" disabled={sending} onClick={onClose}>
        ×
      </button>
      <div className="decision-deck-body">
        {queueControls}
        {collapsedAnswers}
        {newReviewKeys.has(revisionKeyOf(current)) ? (
          <p className="review-round-new" role="status">
            New round
          </p>
        ) : null}
        {current.kind === 'round' &&
        !current.round.media.some((item) => item.role !== 'target') &&
        !current.round.buildId ? (
          missingStatus(
            `/games/${encodeURIComponent(current.gameId)}/review-rounds/${encodeURIComponent(current.round.id)}/missing-media`,
          )
        ) : current.kind === 'round' ? (
          <div key={keyOf(current)}>
            <RoundCard
              gameId={current.gameId}
              round={current.round}
              onAnswered={done}
              swipe
              onPendingChange={setSending}
            />
            {current.round.buildId &&
              missingStatus(
                `/games/${encodeURIComponent(current.gameId)}/review-rounds/${encodeURIComponent(current.round.id)}/missing-media?kind=build`,
              )}
          </div>
        ) : (
          <div key={keyOf(current)}>
            <PreviewCard
              gameId={current.gameId}
              preview={current.preview}
              onAnswered={done}
              swipe
              onPendingChange={setSending}
              media={current.kind === 'preview' ? current.round.media : []}
              {...(current.kind === 'preview' ? { roundId: current.round.id } : {})}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function keyOf(review: WorkerReview): string {
  return `${review.gameId}:${review.kind}:${review.kind === 'round' ? review.round.id : review.preview.buildId}`;
}

function revisionKeyOf(review: WorkerReview): string {
  return review.kind === 'preview' ? `${keyOf(review)}:${review.round.id}` : keyOf(review);
}

function commandKey(command: ReviewCommand): string {
  return `command:${commandSource(command)}:${command.decision_id}:${command.version}`;
}
