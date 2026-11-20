import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import type { GameCommand } from '@ogm/contracts/browser';

import { answerCommand } from '../../features/commands-inbox/commands';
import { markSent } from '../../features/commands-inbox/drafts';
import { letterOf, withoutLinks } from '../../features/commands-inbox/review';

export function ReviewChoice({ gameId, command }: { gameId: string; command: GameCommand }) {
  const [note, setNote] = useState('');
  const [votes, setVotes] = useState<Record<string, 'like' | 'dislike'>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const answer = useMutation({
    mutationFn: async ({ optionId, review }: { optionId: string; review?: import('@ogm/contracts/browser').CommandReview }) => {
      if (command.pick === 'many') {
        await answerCommand(gameId, command, optionId, review);
        return;
      }
      await answerCommand(
        gameId,
        command,
        optionId,
        note.trim() ? { likes: [optionId], dislikes: [], notes: note.trim() } : undefined,
      );
    },
    onSuccess: () => markSent(command),
  });
  if (command.pick === 'many') {
    const likes = command.options.filter(({ id }) => votes[id] === 'like').map(({ id }) => id);
    const dislikes = command.options.filter(({ id }) => votes[id] === 'dislike');
    const selected = likes[0] ?? command.recommend ?? command.options[0]!.id;
    return (
      <div className="review-choice">
        {command.options.map((option) => (
          <fieldset className="review-choice-vote" key={option.id}>
            <legend>{letterOf(command.options, option.id)}: {withoutLinks(option.label)}</legend>
            <button
              type="button"
              aria-pressed={votes[option.id] === 'like'}
              disabled={answer.isPending}
              onClick={() =>
                setVotes((current) => {
                  const next = { ...current };
                  if (next[option.id] === 'like') delete next[option.id];
                  else next[option.id] = 'like';
                  return next;
                })
              }
            >
              Like
            </button>
            <button
              type="button"
              aria-pressed={votes[option.id] === 'dislike'}
              disabled={answer.isPending}
              onClick={() =>
                setVotes((current) => {
                  const next = { ...current };
                  if (next[option.id] === 'dislike') delete next[option.id];
                  else next[option.id] = 'dislike';
                  return next;
                })
              }
            >
              Dislike
            </button>
            {votes[option.id] !== undefined ? (
              <label>
                Note for {letterOf(command.options, option.id)} (optional)
                <textarea
                  value={reasons[option.id] ?? ''}
                  maxLength={1000}
                  onChange={(event) => setReasons((current) => ({ ...current, [option.id]: event.target.value }))}
                />
              </label>
            ) : null}
          </fieldset>
        ))}
        <label>
          Note (optional)
          <textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
        </label>
        <button
          type="button"
          disabled={answer.isPending}
          onClick={() => {
            const likes = command.options.filter(({ id }) => votes[id] === 'like').map(({ id }) => id);
            const liked_notes = command.options.flatMap(({ id }) =>
              votes[id] === 'like' && reasons[id]?.trim() ? [{ option_id: id, reason: reasons[id] }] : [],
            );
            const dislikes = command.options
              .filter(({ id }) => votes[id] === 'dislike')
              .map(({ id }) => ({ option_id: id, ...(reasons[id]?.trim() ? { reason: reasons[id] } : {}) }));
            const review = {
              likes,
              dislikes,
              ...(liked_notes.length ? { liked_notes } : {}),
              ...(note.trim() ? { notes: note } : {}),
            };
            answer.mutate({ optionId: selected, review });
          }}
        >
          {likes.length || dislikes.length ? 'Send review' : 'None'}
        </button>
        {answer.isError ? <p role="alert">The review did not send. Refresh and try again.</p> : null}
      </div>
    );
  }
  return (
    <div className="review-choice">
      <label>
        Note (optional)
        <textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="review-choice-options" aria-label="Choose an option">
        {command.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={answer.isPending}
            aria-label={`Choose ${letterOf(command.options, option.id)}: ${withoutLinks(option.label)}`}
            onClick={() => answer.mutate({ optionId: option.id })}
          >
            {letterOf(command.options, option.id)}
          </button>
        ))}
      </div>
      {answer.isError ? <p role="alert">The review did not send. Refresh and try again.</p> : null}
    </div>
  );
}
