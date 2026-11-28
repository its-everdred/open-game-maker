import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { queryClient } from '../../app/query';
import { api } from '../../lib/api/client';
import { SwipeVerdict } from '../../features/worker-builds/SwipeVerdict';
import { RoundMedia } from './RoundMedia';
import type { MediaMeta as MediaMetaValue } from '@ogm/contracts';

export type Round = {
  category?: 'art' | 'gameplay' | 'sound';
  buildId?: string | null;
  track?: string;
  works?: string[];
  limitations?: string[];
  decisionIds?: string[];
  sourceTickets?: string[];
  clipStatus?: 'captured' | 'unchecked' | null;
  playUrl?: string | null;
  /** The reviewed build started in its scenario, which the card plays in place (#1281). */
  sliceUrl?: string | null;
  id: string;
  postedAt?: string;
  verdict?: 'approved' | 'needs_work' | 'kill' | null;
  verdictAt?: string | null;
  ticket: string;
  question: string | null;
  media: { kind: 'still' | 'clip' | 'audio'; url: string; role?: 'target'; meta?: MediaMetaValue }[];
};
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
  const previous = useRef(new Map<string, string>());
  const [newRounds, setNewRounds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const next = new Map(rounds.map((round) => [round.ticket, round.id]));
    const replaced = rounds
      .filter((round) => previous.current.has(round.ticket) && previous.current.get(round.ticket) !== round.id)
      .map((round) => round.id);
    if (replaced.length) setNewRounds((current) => new Set([...current, ...replaced]));
    previous.current = next;
  }, [rounds]);
  return (
    <>
      {rounds.map((round) => (
        <RoundCard key={round.id} gameId={gameId} round={round} isNew={newRounds.has(round.id)} />
      ))}
    </>
  );
}

export function RoundCard({
  gameId,
  round,
  onAnswered,
  swipe = false,
  onPendingChange,
  onPlay,
  isNew = false,
}: {
  gameId: string;
  round: Round;
  onAnswered?(): void;
  swipe?: boolean;
  onPendingChange?(pending: boolean): void;
  onPlay?(): void;
  isNew?: boolean;
}) {
  const [note, setNote] = useState('');
  const answer = useMutation({
    mutationFn: ({ verdict, note: answerNote }: { verdict: 'approved' | 'needs_work'; note: string }) =>
      api(`/games/${encodeURIComponent(gameId)}/review-rounds/${encodeURIComponent(round.id)}/answer`, {
        method: 'POST',
        json: { verdict, ...(answerNote.trim() ? { note: answerNote } : {}) },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key(gameId) });
      onAnswered?.();
    },
  });
  const delivery = useQuery({
    queryKey: ['review-round-status', gameId, round.id],
    enabled: answer.isSuccess,
    queryFn: () =>
      api<{ status: 'open' | 'pending' | 'sent'; nextPhase?: { phase: string; ticket: string }; newRound?: boolean }>(
        `/games/${encodeURIComponent(gameId)}/review-rounds/${encodeURIComponent(round.id)}/status`,
      ),
    refetchInterval: 5000,
    retry: false,
  });
  const needsPreview =
    Boolean(round.buildId) && round.track !== 'prototype-publish' && round.buildId !== `live-${round.id}`;
  const media = (
    <>
      <RoundMedia media={round.media} />
      {round.sliceUrl ? (
        <div className="review-deck-playable">
          <iframe
            allow="autoplay; fullscreen; gamepad"
            className="review-slice"
            loading="lazy"
            src={inAppPath(round.sliceUrl)}
            title={`Play the build for ticket ${round.ticket}`}
          />
        </div>
      ) : null}
      {round.question ? <p>{round.question}</p> : null}
      {round.playUrl ? (
        <p>
          {/* The build opens in the game's editor inside the app; a new tab would take a home-screen app to the browser. */}
          <Link to={inAppPath(round.playUrl)} onClick={onPlay}>
            Play this build
          </Link>
        </p>
      ) : null}
      {round.buildId && !round.playUrl && <p role="alert">The playable review is unavailable. Try again later.</p>}
      {round.clipStatus === 'unchecked' ? <p>Clip: unchecked</p> : null}
      {round.works?.length ? (
        <p>
          <strong>Works now:</strong> {round.works.join('; ')}
        </p>
      ) : null}
      {round.limitations?.length ? (
        <p>
          <strong>Known limitations:</strong> {round.limitations.join('; ')}
        </p>
      ) : null}
      {round.decisionIds?.length ? (
        <p>
          <strong>Weigh in on:</strong> {round.decisionIds.join(', ')}
        </p>
      ) : null}
    </>
  );
  return (
    <section className="review-deck" aria-label={`Review for ticket ${round.ticket}`}>
      {isNew ? (
        <p className="review-round-new" role="status">
          New round
        </p>
      ) : null}
      {swipe ? (
        <SwipeVerdict
          disabled={answer.isPending || answer.isSuccess || needsPreview}
          onPendingChange={onPendingChange}
          onSend={async (verdict, answerNote) => {
            await answer.mutateAsync({ verdict, note: answerNote });
          }}
        >
          {media}
        </SwipeVerdict>
      ) : (
        <>
          {media}
          <label>
            Note (optional)
            <textarea
              disabled={needsPreview}
              value={note}
              maxLength={3900}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="review-deck-actions">
            <button
              type="button"
              disabled={answer.isPending || answer.isSuccess || needsPreview}
              onClick={() => answer.mutate({ verdict: 'approved', note })}
            >
              Looks right
            </button>
            <button
              type="button"
              disabled={answer.isPending || answer.isSuccess || needsPreview}
              onClick={() => answer.mutate({ verdict: 'needs_work', note })}
            >
              Needs work
            </button>
          </div>
        </>
      )}
      {answer.isSuccess && (
        <p role="status">
          Saved · {delivery.data?.status === 'sent' ? 'sent to agent' : 'sending to agent'}
          {delivery.data?.newRound ? ' · New round ready' : ''}
          {delivery.data?.nextPhase
            ? ` · Next phase: ${delivery.data.nextPhase.phase} (ticket ${delivery.data.nextPhase.ticket})`
            : ''}
        </p>
      )}
      {answer.isError ? <p role="alert">The review may not have sent. Tap the same verdict to retry.</p> : null}
    </section>
  );
}

function inAppPath(url: string): string {
  const parsed = new URL(url, window.location.origin);
  return `${parsed.pathname}${parsed.search}`;
}
