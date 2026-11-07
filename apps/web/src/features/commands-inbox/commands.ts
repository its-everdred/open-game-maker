import { useQuery } from '@tanstack/react-query';

import type { CommandReview, GameCommand, GameCommandsPage } from '@ogm/contracts';

import { queryClient } from '../../app/query';
import { api } from '../../lib/api/client';
import { answerCheckpoint } from '../build-chat/checkpoints';

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

// A Command a job owns answers through the job's checkpoint route. A Command with no job — a registered game's, read
// from its own aiur instance — has no checkpoint to validate against, so it answers through the game's route with the
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
    await answerCheckpoint(command.job_id, command.checkpoint_id, optionId, review);
  }
  await queryClient.invalidateQueries({ queryKey: gameCommandsQueryKey(gameId) });
}
