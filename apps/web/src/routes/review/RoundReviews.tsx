import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { queryClient } from '../../app/query';
import { api } from '../../lib/api/client';

type Round = { id: string; ticket: string; question: string | null; media: { kind: 'still' | 'clip'; url: string }[] };
const key = (gameId: string) => ['game-review-rounds', gameId] as const;

export function useReviewRounds(gameId: string) {
  return useQuery({
    queryKey: key(gameId),
    queryFn: () => api<{ rounds: Round[] }>(`/games/${encodeURIComponent(gameId)}/review-rounds`),
    refetchInterval: 5000,
    retry: false,
  });
}

export function RoundReviews({ gameId, rounds }: { gameId: string; rounds: Round[] }) {
  return (
    <>
      {rounds.map((round) => (
        <RoundCard key={round.id} gameId={gameId} round={round} />
      ))}
    </>
  );
}

function RoundCard({ gameId, round }: { gameId: string; round: Round }) {
  const [note, setNote] = useState('');
  const answer = useMutation({
    mutationFn: (verdict: 'approved' | 'needs_work') =>
      api(`/games/${encodeURIComponent(gameId)}/review-rounds/${encodeURIComponent(round.id)}/answer`, {
        method: 'POST',
        json: { verdict, ...(note.trim() ? { note } : {}) },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(gameId) }),
  });
  return (
    <section className="review-deck" aria-label={`Review for ticket ${round.ticket}`}>
      {round.media.map((item) => (
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
      {round.question ? <p>{round.question}</p> : null}
      <label>
        Note (optional)
        <textarea value={note} maxLength={3900} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="review-deck-actions">
        <button type="button" disabled={answer.isPending} onClick={() => answer.mutate('approved')}>
          Looks right
        </button>
        <button type="button" disabled={answer.isPending} onClick={() => answer.mutate('needs_work')}>
          Needs work
        </button>
      </div>
      {answer.isError ? <p role="alert">The review may not have sent. Tap the same verdict to retry.</p> : null}
    </section>
  );
}
