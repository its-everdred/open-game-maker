import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import type { GameCommand } from '@ogm/contracts/browser';

import { answerCommand } from '../../features/commands-inbox/commands';
import { markSent } from '../../features/commands-inbox/drafts';
import { letterOf, withoutLinks } from '../../features/commands-inbox/review';

export function ReviewChoice({ gameId, command }: { gameId: string; command: GameCommand }) {
  const [note, setNote] = useState('');
  const answer = useMutation({
    mutationFn: (optionId: string) =>
      answerCommand(
        gameId,
        command,
        optionId,
        note.trim() ? { likes: [optionId], dislikes: [], notes: note.trim() } : undefined,
      ),
    onSuccess: () => markSent(command),
  });
  if (command.pick === 'many') return null;
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
            onClick={() => answer.mutate(option.id)}
          >
            {letterOf(command.options, option.id)}
          </button>
        ))}
      </div>
      {answer.isError ? <p role="alert">The review did not send. Refresh and try again.</p> : null}
    </div>
  );
}
