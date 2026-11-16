import type { CreatorCommand, GameCommand } from '@ogm/contracts';
export type CoreReviewCommand = GameCommand & { source: 'core' };
export type ReviewCommand = CreatorCommand | CoreReviewCommand;
export function commandSource(command: ReviewCommand): string {
  return 'source' in command ? 'core' : command.game_id;
}
export function commandPath(command: ReviewCommand): string {
  return 'source' in command ? '/core/commands' : `/games/${encodeURIComponent(command.game_id)}/commands`;
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
