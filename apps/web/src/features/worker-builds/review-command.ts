import type { CreatorCommand, GameCommand } from '@ogm/contracts';
// `daemon: 'pc'` marks a Command held by the PC's core daemon rather than the NUC's.
export type CoreReviewCommand = GameCommand & { source: 'core'; daemon?: 'pc' };
export type ReviewCommand = CreatorCommand | CoreReviewCommand;
export function readOnlyGameIds(
  games: readonly { id: string; ownerId: string }[],
  userId: string | undefined,
  capability: 'creator' | 'player' | undefined,
): string[] {
  return games.filter((game) => game.ownerId !== userId || capability === 'player').map((game) => game.id);
}
export function withoutGameCommands<T extends { decision_id: string }>(
  core: readonly T[],
  games: readonly { decision_id: string }[],
): T[] {
  const ids = new Set(games.map((command) => command.decision_id));
  return core.filter((command) => !ids.has(command.decision_id));
}
export function commandSource(command: ReviewCommand): string {
  if (!('source' in command)) return command.game_id;
  return command.daemon === 'pc' ? 'core:pc' : 'core';
}
function daemonQuery(command: ReviewCommand): string {
  return 'source' in command && command.daemon === 'pc' ? '?daemon=pc' : '';
}
export function commandPath(command: ReviewCommand, suffix = ''): string {
  return 'source' in command
    ? `/core/commands${suffix}${daemonQuery(command)}`
    : `/games/${encodeURIComponent(command.game_id)}/commands${suffix}`;
}
export function ticketStatePath(command: CoreReviewCommand & { ticket: string }): string {
  return `/core/tickets/${encodeURIComponent(command.ticket)}/state${daemonQuery(command)}`;
}
export function commandTitle(command: ReviewCommand): string {
  return 'source' in command ? 'Core' : command.game_title;
}

export type ReviewTarget =
  { gameId: string; ticket: string; title: string } | { source: 'core'; ticket: string; title: string };
export function targetSource(target: ReviewTarget): string {
  return 'source' in target ? 'core' : target.gameId;
}
export function targetPath(target: ReviewTarget): string {
  return 'source' in target
    ? `/core/tickets/${encodeURIComponent(target.ticket)}/missing-review`
    : `/games/${encodeURIComponent(target.gameId)}/tickets/${encodeURIComponent(target.ticket)}/missing-review`;
}
