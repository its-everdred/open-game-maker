import { useState } from 'react';

import type { GameCommand } from '@ogm/contracts';
import { reviewPath } from '@ogm/contracts/browser';

import { Icon } from '../../components/Icon';
import { AiurCommands, gameScope, type AiurCommandAnswer } from '../aiur/embed';
import { answerCommand, useGameCommands } from './commands';
import { isReviewDeck } from './ReviewDeck';
import { ReviewRowLink } from './ReviewRows';
import './commands-inbox.css';

// One game's open Commands (M3): the same list the embeddable `<aiur-commands>` component renders when aiur ships it.
// Answering goes through the job's checkpoint route when a job owns the Command, and through the game's own route when
// it does not; either way the answer lands in aiur's canonical Decision API. A Command whose options carry media (A3)
// is a row: its first sample, a short title and its open, draft or sent state; a tap opens its deck on the review
// screen, where the arrows walk the game's other questions.
export function CommandsInbox({
  gameId,
  slug,
  onOpenJob,
}: {
  gameId: string;
  slug?: string | null;
  onOpenJob(jobId: string): void;
}) {
  const { commands } = useGameCommands(gameId);
  const [answering, setAnswering] = useState<string>();

  if (commands.length === 0) return null;

  const answer = async (command: GameCommand, optionId: string) => {
    setAnswering(command.checkpoint_id);
    try {
      await answerCommand(gameId, command, optionId);
    } catch {
      // The Command stays in the inbox; the route's status (409 for a Command another writer answered) is final.
    } finally {
      setAnswering(undefined);
    }
  };
  const fromComponent = (detail: AiurCommandAnswer) => {
    // The checkpoint id is unique across the inbox; a Command with no job carries aiur's decision id as its checkpoint.
    const command = commands.find((candidate) => candidate.checkpoint_id === detail.checkpoint_id);
    if (command) void answer(command, detail.option_id);
  };

  return (
    <AiurCommands
      scope={gameScope(
        gameId,
        commands.flatMap((command) => (command.ticket === null ? [] : [command.ticket])),
      )}
      commands={commands}
      onAnswer={fromComponent}
    >
      <ul className="commands-inbox" aria-label="Requests">
        {commands.map((command) => {
          const jobId = command.job_id;
          return (
            <li className="commands-inbox-item" key={command.checkpoint_id}>
              {isReviewDeck(command) ? (
                <ReviewRowLink command={command} href={deckHref(gameId, slug, command)} />
              ) : (
                <>
                  <p className="commands-inbox-question">{command.question}</p>
                  <div className="build-chat-options">
                    {command.options.map((option) => (
                      <button
                        aria-label={option.label}
                        className="build-chat-option"
                        disabled={answering !== undefined}
                        key={option.id}
                        onClick={() => void answer(command, option.id)}
                        type="button"
                      >
                        {option.media && (
                          <span className="checkpoint-option-media" aria-hidden="true">
                            {option.media.duration_ms === undefined ? (
                              <img alt="" src={option.media.url} />
                            ) : (
                              <video
                                muted
                                playsInline
                                poster={option.media.poster}
                                preload="metadata"
                                src={option.media.url}
                              />
                            )}
                          </span>
                        )}
                        <span className="checkpoint-option-label">{option.label}</span>
                        {option.id === command.recommend && (
                          <span className="checkpoint-recommended">Builder&apos;s pick</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {/* A Command read from the game's own aiur instance belongs to no job, so there is no conversation here
                to open; the job's Commands keep the button. */}
              {jobId !== null && (
                <button
                  aria-label={`Open ${command.title}`}
                  className="commands-inbox-open tap-secondary"
                  onClick={() => onOpenJob(jobId)}
                  type="button"
                >
                  <Icon name="speak" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </AiurCommands>
  );
}

// The deck's own screen: the short link when the game has a slug and the Command a number, the legacy link otherwise.
function deckHref(gameId: string, slug: string | null | undefined, command: GameCommand): string {
  if (slug && command.review_number !== undefined) return reviewPath(slug, command.review_number);
  return `/game/${encodeURIComponent(gameId)}/review/${encodeURIComponent(command.checkpoint_id)}`;
}
