import { useQueries } from '@tanstack/react-query';
import type { CommandReviewEntry } from '@ogm/contracts';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api/client';
import { commandSource, type ReviewCommand } from './review-command';
import type { WorkerReview } from './useWorkerReviews';

const storageKey = 'ogm:answered-review-commands';
const gameIdsStorageKey = 'ogm:answered-review-game-ids';
export type AnsweredCommand = { id: string; gameId: string; review: CommandReviewEntry };
export type SessionAnsweredCommand = { command: ReviewCommand };

export function useAnsweredReviews(_reviews: readonly WorkerReview[], commands: readonly ReviewCommand[]) {
  const [sessionAnsweredCommands, setSessionAnsweredCommands] = useState<SessionAnsweredCommand[]>(readSessionCommands);
  const [knownGameIds, setKnownGameIds] = useState<string[]>(readKnownGameIds);
  const visibleGameIds = commands.filter((command) => !('source' in command)).map(commandSource);
  const gameIds = Array.from(
    new Set([
      ...knownGameIds,
      ...visibleGameIds,
      ...sessionAnsweredCommands.map(({ command }) => commandSource(command)).filter((source) => source !== 'core'),
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
  const queries = useQueries({
    queries: gameIds.map((gameId) => ({
      queryKey: ['game-review-ledger', gameId],
      queryFn: () => api<{ reviews: CommandReviewEntry[] }>(`/games/${encodeURIComponent(gameId)}/reviews`),
      refetchInterval: 5_000,
      retry: false,
    })),
  });
  const savedCommands = gameIds.flatMap((gameId, index): AnsweredCommand[] => {
    const page = queries[index]?.data as { reviews: CommandReviewEntry[] } | undefined;
    return (page?.reviews ?? []).map((review) => ({ id: review.id, gameId, review }));
  });
  const rememberCommand = (command: ReviewCommand) => {
    setSessionAnsweredCommands((previous) => {
      const next = [
        ...previous.filter(
          ({ command: prior }) =>
            commandSource(prior) !== commandSource(command) || prior.decision_id !== command.decision_id,
        ),
        { command },
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
