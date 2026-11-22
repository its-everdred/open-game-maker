import type { CommandReviewEntry } from '@ogm/contracts';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api/client';
import { queryClient } from '../../app/query';
import { commandSource, type ReviewCommand } from './review-command';
import type { WorkerReview } from './useWorkerReviews';

const storageKey = 'ogm:answered-review-commands';
const gameIdsStorageKey = 'ogm:answered-review-game-ids';
export type AnsweredCommand = { id: string; gameId: string; review: CommandReviewEntry };
export type SentReview = { likes: string[]; dislikes: { option_id: string; reason?: string }[]; notes?: string };
export type SessionAnsweredCommand = { command: ReviewCommand; review?: SentReview };

export function useAnsweredReviews(_reviews: readonly WorkerReview[], commands: readonly ReviewCommand[]) {
  const [sessionAnsweredCommands, setSessionAnsweredCommands] = useState<SessionAnsweredCommand[]>(readSessionCommands);
  const [knownGameIds, setKnownGameIds] = useState<string[]>(readKnownGameIds);
  const [ledgerPages, setLedgerPages] = useState<Record<string, CommandReviewEntry[]>>({});
  const visibleGameIds = commands.filter((command) => !('source' in command)).map(commandSource);
  const gameIds = Array.from(
    new Set([
      ...knownGameIds,
      ...visibleGameIds,
      ...sessionAnsweredCommands
        .filter(({ command }) => !('source' in command))
        .map(({ command }) => commandSource(command)),
    ]),
  );
  useEffect(() => {
    const next = Array.from(new Set([...knownGameIds, ...visibleGameIds]));
    if (next.length === knownGameIds.length) return;
    setKnownGameIds(next);
    try {
      sessionStorage.setItem(gameIdsStorageKey, JSON.stringify(next));
    } catch {
      // Session persistence is best effort when storage is unavailable.
    }
  }, [knownGameIds, visibleGameIds.join('\u0000')]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void Promise.all(
        gameIds.map(async (gameId) => {
          try {
            const page = await queryClient.fetchQuery({
              queryKey: ['game-review-ledger', gameId],
              queryFn: () => api<{ reviews: CommandReviewEntry[] }>(`/games/${encodeURIComponent(gameId)}/reviews`),
              staleTime: 0,
            });
            if (active) setLedgerPages((previous) => ({ ...previous, [gameId]: page.reviews }));
          } catch {
            // Failed refreshes leave the last available answer summaries visible.
          }
        }),
      );
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [gameIds.join('\u0000')]);
  const savedCommands = gameIds.flatMap((gameId): AnsweredCommand[] => {
    return (ledgerPages[gameId] ?? []).map((review) => ({ id: review.id, gameId, review }));
  });
  const rememberCommand = (command: ReviewCommand, review?: SentReview) => {
    setSessionAnsweredCommands((previous) => {
      const next = [
        ...previous.filter(
          ({ command: prior }) =>
            commandSource(prior) !== commandSource(command) || prior.decision_id !== command.decision_id,
        ),
        { command, ...(review ? { review } : {}) },
      ];
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Session persistence is best effort when storage is unavailable.
      }
      return next;
    });
  };
  return { savedCommands, sessionAnsweredCommands, rememberCommand };
}

function readSessionCommands(): SessionAnsweredCommand[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is SessionAnsweredCommand =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.command === 'object' &&
        item.command !== null &&
        'decision_id' in item.command &&
        typeof item.command.decision_id === 'string',
    );
  } catch {
    return [];
  }
}

function readKnownGameIds(): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(gameIdsStorageKey) ?? '[]');
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
  } catch {
    return [];
  }
}
