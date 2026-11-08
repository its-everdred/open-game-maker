import type { GameCommand } from '@ogm/contracts';

// The review deck's deep link (#591): `/<slug>/review/<n>`, the game's slug and the Command's short number inside the
// game. The Executor and notifications build it with this one function, shared with the API.
export { reviewPath } from '@ogm/contracts/browser';

// The legacy link's last segment: the Command's checkpoint id, or its decision id for a link built from aiur's side.
export function findCommand(commands: readonly GameCommand[], commandId: string): GameCommand | undefined {
  return commands.find((command) => command.checkpoint_id === commandId || command.decision_id === commandId);
}

export function findCommandByNumber(commands: readonly GameCommand[], number: string): GameCommand | undefined {
  return commands.find((command) => command.review_number !== undefined && String(command.review_number) === number);
}
