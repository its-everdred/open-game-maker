import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CommandReviewEntry, GameCommandsPage } from '@ogm/contracts';
import { api } from '../../lib/api/client';
import { RoundCard, type Round } from '../../routes/review/RoundReviews';
import { PreviewCard } from '../../routes/review/PreviewReviews';
import { CommandReviewCard } from './CommandReviewCard';
import { AnsweredReviewCard } from './AnsweredReviewCard';
import { useWorkerReviews } from './useWorkerReviews';
import './review-inbox.css';

export function ConversationReviews({
  gameId,
  ticket,
  creatorId,
  jobId,
  inline = false,
  showEmpty = false,
  visible = true,
}: {
  gameId: string;
  ticket: string;
  creatorId?: string;
  jobId?: string;
  inline?: boolean;
  showEmpty?: boolean;
  visible?: boolean;
}) {
  const commands = useQuery({
    queryKey: ['conversation-commands', creatorId, gameId],
    enabled: Boolean(creatorId),
    queryFn: () => api<GameCommandsPage>(`/games/${encodeURIComponent(gameId)}/commands`),
    refetchInterval: 15000,
    retry: false,
  });
  const reviews = useWorkerReviews([{ id: gameId }], creatorId);
  const ledger = useQuery({
    queryKey: ['game-review-ledger', creatorId, gameId],
    enabled: Boolean(creatorId),
    queryFn: () => api<{ reviews: CommandReviewEntry[] }>(`/games/${encodeURIComponent(gameId)}/reviews`),
    refetchInterval: 15000,
    retry: false,
  });
  const history = useQuery({
    queryKey: ['ticket-review-history', creatorId, gameId, ticket],
    enabled: Boolean(creatorId),
    queryFn: () =>
      api<{ rounds: Round[] }>(
        `/games/${encodeURIComponent(gameId)}/review-rounds?includeGameplay=1&historyTicket=${encodeURIComponent(ticket)}`,
      ),
    refetchInterval: 15000,
    retry: false,
  });
  const answered = (ledger.data?.reviews ?? []).filter(
    (item) => item.ticket === ticket || (!item.ticket && !!jobId && item.job_id === jobId),
  );
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const entries = [
    ...(commands.data?.commands ?? [])
      .filter(
        (item) =>
          (item.ticket === ticket || (!item.ticket && !!jobId && item.job_id === jobId)) &&
          !answered.some((review) => review.decision_id === item.decision_id),
      )
      .map((item) => ({ kind: 'command' as const, at: item.opened_at, item })),
    ...reviews.reviews
      .filter((item) => (item.kind === 'standalone-preview' ? item.preview.ticket : item.round.ticket) === ticket)
      .map((item) => ({
        kind: 'review' as const,
        at: item.kind === 'standalone-preview' ? item.preview.createdAt : (item.round.postedAt ?? ''),
        item,
      })),
    ...answered.map((item) => ({ kind: 'answered' as const, at: item.at, item })),
    ...(history.data?.rounds ?? [])
      .filter(
        (round) =>
          !round.decisionIds?.some((id) => answered.some((entry) => entry.decision_id === id)) &&
          (round.verdict ||
            (!reviews.loading &&
              !reviews.error &&
              !!creatorId &&
              !reviews.reviews.some((review) => review.kind !== 'standalone-preview' && review.round.id === round.id))),
      )
      .map((item) => ({ kind: 'answered-round' as const, at: item.postedAt ?? item.verdictAt ?? '', item })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const entrySignature = entries.map((entry) => `${entry.kind}:${entry.at}`).join('|');
  useEffect(() => {
    if (visible && list.current && pinned.current) list.current.scrollTop = list.current.scrollHeight;
  }, [entrySignature, visible]);
  return (
    <div
      className={inline ? 'conversation-inline-reviews' : 'build-chat-messages'}
      ref={list}
      aria-label="Reviews"
      onScroll={(event) => {
        const el = event.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 32;
      }}
    >
      {entries.map((entry) => {
        if (entry.kind === 'command')
          return (
            <CommandReviewCard
              key={`command:${entry.item.decision_id}`}
              command={{ ...entry.item, game_id: gameId, game_title: '' }}
              onAnswered={() => {
                void commands.refetch();
                void ledger.refetch();
              }}
            />
          );
        if (entry.kind === 'answered')
          return (
            <AnsweredReviewCard
              key={`answered:${entry.item.id}`}
              title={entry.item.title}
              summary={[
                ...entry.item.likes.map((item) => `Liked ${item.label}`),
                ...entry.item.dislikes.map((item) => `Disliked ${item.label}${item.reason ? `: ${item.reason}` : ''}`),
                ...(entry.item.notes ? [entry.item.notes] : []),
              ].join(' · ')}
            />
          );
        if (entry.kind === 'answered-round')
          return (
            <AnsweredReviewCard
              key={`answered-round:${entry.item.id}`}
              title={entry.item.question ?? `Ticket ${ticket}`}
              summary={
                entry.item.verdict === 'approved'
                  ? 'Approved'
                  : entry.item.verdict === 'needs_work'
                    ? 'Needs work'
                    : entry.item.verdict === 'kill'
                      ? 'Stopped'
                      : 'Superseded'
              }
            />
          );
        const review = entry.item;
        return review.kind === 'round' ? (
          <RoundCard key={`round:${review.round.id}`} gameId={gameId} round={review.round} />
        ) : (
          <PreviewCard
            key={`preview:${review.preview.buildId}`}
            gameId={gameId}
            preview={review.preview}
            {...(review.kind === 'preview' ? { roundId: review.round.id, media: review.round.media } : {})}
          />
        );
      })}
      {(!inline || showEmpty) &&
        !entries.length &&
        !commands.isLoading &&
        !reviews.loading &&
        !ledger.isLoading &&
        !history.isLoading && <p>No reviews yet.</p>}
      {(commands.isError || reviews.error || ledger.isError || history.isError) && (
        <p role="alert">Some reviews could not be loaded.</p>
      )}
    </div>
  );
}
