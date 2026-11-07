import type { GameCommand } from '@ogm/contracts';

// The review deck's deep link (A3): the Executor pushes one link to the creator and it opens the same deck the game's
// inbox renders. The last segment is the Command's checkpoint id, the identifier the inbox row already carries; a
// decision id resolves too, so a link built from aiur's side lands as well.
export function reviewPath(gameId: string, command: Pick<GameCommand, 'checkpoint_id'>): string {
  return `/game/${encodeURIComponent(gameId)}/review/${encodeURIComponent(command.checkpoint_id)}`;
}

export function findCommand(commands: readonly GameCommand[], commandId: string): GameCommand | undefined {
  return commands.find((command) => command.checkpoint_id === commandId || command.decision_id === commandId);
}
