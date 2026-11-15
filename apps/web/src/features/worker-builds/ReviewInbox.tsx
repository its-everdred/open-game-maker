import { useEffect, useState } from 'react';
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
  const [current, setCurrent] = useState<WorkerReview | undefined>(reviews[0]);
  useEffect(() => {
    if (current?.kind !== 'round' || !current.round.buildId) return;
    const recovered = reviews.find(
      (review) => review.kind === 'preview' && review.gameId === current.gameId && review.round.id === current.round.id,
    );
    if (recovered) setCurrent(recovered);
  }, [current, reviews]);
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
  const done = () => {
    const seen = new Set(answered).add(keyOf(current));
    setAnswered(seen);
    setCurrent(reviews.find((review) => !seen.has(keyOf(review))));
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
        {current.kind === 'round' ? (
          <RoundCard key={keyOf(current)} gameId={current.gameId} round={current.round} onAnswered={done} />
        ) : (
          <div key={keyOf(current)}>
            {current.round.media.map((item) => (
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
