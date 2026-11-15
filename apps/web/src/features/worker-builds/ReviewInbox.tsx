import { useState } from 'react';
import type { CreatorCommand } from '@ogm/contracts';
import { Dialog } from '../../components/Dialog';
import { DecisionDeck } from '../commands-inbox/DecisionDeck';
import { PreviewCard } from '../../routes/review/PreviewReviews';
import { RoundCard } from '../../routes/review/RoundReviews';
import type { WorkerReview } from './useWorkerReviews';
import '../build-chat/conversation-modal.css';
import '../commands-inbox/review-deck.css';

export function ReviewInbox({
  reviews,
  commands,
  onClose,
}: {
  reviews: readonly WorkerReview[];
  commands: readonly CreatorCommand[];
  onClose(): void;
}) {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [showCommands, setShowCommands] = useState(reviews.length === 0);
  const current = reviews.find((review) => !answered.has(keyOf(review)));
  if (showCommands && commands[0]) return <DecisionDeck commands={commands} first={commands[0]} onClose={onClose} />;
  if (!current) {
    if (commands[0]) return <DecisionDeck commands={commands} first={commands[0]} onClose={onClose} />;
    return (
      <Dialog
        title="Needs Review"
        className="job-conversation-dialog"
        backdropClassName="job-conversation-backdrop"
        onClose={onClose}
      >
        <button type="button" onClick={onClose}>
          Close
        </button>
        <p>All reviews answered.</p>
      </Dialog>
    );
  }
  const done = () => setAnswered((before) => new Set(before).add(keyOf(current)));
  return (
    <Dialog
      title="Needs Review"
      className="job-conversation-dialog decision-deck"
      backdropClassName="job-conversation-backdrop"
      onClose={onClose}
    >
      <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <div className="decision-deck-body">
        {current.kind === 'round' ? (
          <RoundCard key={keyOf(current)} gameId={current.gameId} round={current.round} onAnswered={done} />
        ) : (
          <PreviewCard key={keyOf(current)} gameId={current.gameId} preview={current.preview} onAnswered={done} />
        )}
        {commands.length > 0 && (
          <button type="button" onClick={() => setShowCommands(true)}>
            Questions
          </button>
        )}
      </div>
    </Dialog>
  );
}

function keyOf(review: WorkerReview): string {
  return `${review.gameId}:${review.kind}:${review.kind === 'round' ? review.round.id : review.preview.buildId}`;
}
