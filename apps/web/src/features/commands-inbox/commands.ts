import { useQuery } from '@tanstack/react-query';

import type { CommandReview, CreatorCommandsPage, GameCommand, GameCommandsPage } from '@ogm/contracts';

import { queryClient } from '../../app/query';
import { api, ApiError } from '../../lib/api/client';
import { answerJobCommand } from '../build-chat/commands';
import type { CoreReviewCommand, ReviewTarget } from '../worker-builds/review-command';

// The game's open aiur Commands (M3). Polling matches the build list: a Command opened by a running agent shows up
// without a reload.
const POLL_MS = 30_000;
const EMPTY: GameCommand[] = [];

export const gameCommandsQueryKey = (gameId: string) => ['game-commands', gameId] as const;

export function useGameCommands(gameId: string | null | undefined) {
  const query = useQuery({
    queryKey: gameCommandsQueryKey(gameId ?? ''),
    enabled: Boolean(gameId),
    queryFn: () => api<GameCommandsPage>(`/games/${encodeURIComponent(gameId!)}/commands`),
    refetchInterval: POLL_MS,
    retry: false,
  });
  return { ...query, commands: query.data?.commands ?? EMPTY };
}

const NO_DECISIONS: CreatorCommandsPage['commands'] = [];
const NO_SESSIONS: NonNullable<CreatorCommandsPage['question_sessions']> = [];
export const creatorCommandsQueryKey = ['creator-commands'] as const;

// The menu's decision inbox: the signed-in creator's player-facing Commands across all their games, in priority order.
// Keyed by the creator, so one account's decisions are never shown to the next one signed in on this device.
export function useCreatorCommands(creatorId: string | undefined) {
  const enabled = creatorId !== undefined;
  const query = useQuery({
    queryKey: [...creatorCommandsQueryKey, creatorId],
    enabled,
    queryFn: () => api<CreatorCommandsPage>('/me/commands'),
    refetchInterval: POLL_MS,
    retry: false,
  });
  return {
    ...query,
    commands: enabled ? (query.data?.commands ?? NO_DECISIONS) : NO_DECISIONS,
    // Games whose queued product questions offer a quick voice chat (ticket 612): one entry each, never opened on its own.
    sessions: enabled ? (query.data?.question_sessions ?? NO_SESSIONS) : NO_SESSIONS,
  };
}

// The review screen includes every creator Command, including questions queued for voice.
export function useCreatorReviewCommands(creatorId: string | undefined) {
  const query = useQuery({
    queryKey: [...creatorCommandsQueryKey, creatorId, 'review'],
    enabled: Boolean(creatorId),
    queryFn: () => api<CreatorCommandsPage & { unavailable?: boolean }>('/me/commands?includeQuestions=1'),
    refetchInterval: POLL_MS,
    retry: false,
  });
  return {
    commands: creatorId ? (query.data?.commands ?? NO_DECISIONS) : NO_DECISIONS,
    error: query.isError || query.data?.unavailable === true,
    loading: query.isLoading,
  };
}

type CorePage = { commands: CoreReviewCommand[]; targets: ReviewTarget[]; targetsUnavailable?: boolean };

export function useCoreReviewCommands(creatorId: string | undefined) {
  const query = useQuery({
    queryKey: [...creatorCommandsQueryKey, creatorId, 'core'],
    enabled: Boolean(creatorId),
    // Only the instance owner has core Commands; anyone else is refused, which is an empty list, not a failed load.
    queryFn: () =>
      api<CorePage>('/me/core-commands').catch((error: unknown): CorePage => {
        if (error instanceof ApiError && error.status === 403) return { commands: [], targets: [] };
        throw error;
      }),
    refetchInterval: POLL_MS,
    retry: false,
  });
  return {
    commands: creatorId ? (query.data?.commands ?? []) : [],
    targets: creatorId ? (query.data?.targets ?? []) : [],
    error: query.isError || query.data?.targetsUnavailable === true,
    loading: query.isLoading,
  };
}

// A Command a job owns answers through the job's Command route. A Command with no job — a registered game's, read
// from its own aiur instance — has no Command to validate against, so it answers through the game's route with the
// version the player saw. Both end at aiur's canonical Decision API, and a review deck's like/dislike map travels
// either way so the game's ledger records it.
export async function answerCommand(
  gameId: string,
  command: GameCommand,
  optionId: string,
  review?: CommandReview,
): Promise<void> {
  const carried = review === undefined ? {} : { review };
  if (command.job_id === null) {
    await api(`/games/${encodeURIComponent(gameId)}/commands/${encodeURIComponent(command.decision_id)}/answer`, {
      method: 'POST',
      json: { option_id: optionId, version: command.version, ...carried },
    });
  } else {
    await answerJobCommand(command.job_id, command.command_id, optionId, review);
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: gameCommandsQueryKey(gameId) }),
    queryClient.invalidateQueries({ queryKey: creatorCommandsQueryKey }),
  ]);
}
