import { useEffect, useState } from 'react';

import type { CreatorCommand } from '@ogm/contracts';

import { Dialog } from '../../components/Dialog';
import { CommandOptions } from './CommandOptions';
import { answerCommand } from './commands';
import { withoutLinks } from './review';
import { isReviewDeck, ReviewDeck } from './ReviewDeck';
import '../build-chat/conversation-modal.css';
import './commands-inbox.css';
import './decision-deck.css';

// The menu's decision modal (#596): one open decision at a time, from any of the creator's games. Once it is answered
// the deck offers the next open decision in the menu's order, so the creator walks the whole inbox without going back
// to the list; answering the last one closes the deck (a review deck stays on its sent state until closed). The decision
// on screen is kept as it was opened: the inbox refetches after an answer and drops it. What is next is read from that
// refetched list, so a decision answered elsewhere meanwhile is never offered.
export function DecisionDeck({
  commands,
  first,
  onClose,
}: {
  commands: readonly CreatorCommand[];
  first: CreatorCommand;
  onClose(): void;
}) {
  const [current, setCurrent] = useState(first);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const done = answered.has(keyOf(current));
  const next = commands.find((command) => keyOf(command) !== keyOf(current) && !answered.has(keyOf(command)));
  const markAnswered = () => setAnswered((before) => new Set(before).add(keyOf(current)));
  // The last open decision answered: nothing is left to walk to. Closing here, not after the answer's await, means an
  // answer that lands after the creator closed this deck can never close the next one they open.
  const finished = done && next === undefined && !isReviewDeck(current);
  useEffect(() => {
    if (finished) onClose();
  }, [finished, onClose]);
  const answer = async (optionId: string) => {
    setSending(true);
    setError(undefined);
    try {
      await answerCommand(current.game_id, current, optionId);
      markAnswered();
    } catch {
      setError('That answer did not send. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      title={current.summary ?? current.title}
      className="job-conversation-dialog decision-deck"
      backdropClassName="job-conversation-backdrop"
      onClose={onClose}
    >
      <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
      <div className="decision-deck-body">
        <p className="commands-inbox-question">{withoutLinks(current.question)}</p>
        {isReviewDeck(current) ? (
          <ReviewDeck key={keyOf(current)} gameId={current.game_id} command={current} onAnswered={markAnswered} />
        ) : (
          <CommandOptions command={current} disabled={sending || done} onAnswer={(optionId) => void answer(optionId)} />
        )}
        {error && (
          <p className="review-deck-error" role="alert">
            {error}
          </p>
        )}
        {/* A refused answer (one answered elsewhere, say) must not trap the walk on it. */}
        {(done || error) && next && (
          <button
            className="review-deck-send decision-deck-next"
            onClick={() => {
              setError(undefined);
              setCurrent(next);
            }}
            type="button"
          >
            Next decision
          </button>
        )}
      </div>
    </Dialog>
  );
}

// Each game has its own aiur instance, so a decision is named by its game as well as its id.
function keyOf(command: CreatorCommand): string {
  return `${command.game_id}:${command.decision_id}`;
}
