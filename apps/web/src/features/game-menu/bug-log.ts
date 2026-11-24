import { lastReportError } from '../bug-report';
import type { GameFrameState } from '../editor/frame';

/**
 * The host's log a bug carries (#1326): which game and build, how the frame stands and the last error the page saw.
 * Only ids, states and error text; nothing the player typed elsewhere and no credentials.
 */
export function bugLog({
  gameId,
  buildId,
  mode,
  frame,
  now = new Date(),
}: {
  gameId: string;
  buildId?: string;
  mode: 'play' | 'edit';
  frame: GameFrameState;
  now?: Date;
}): string {
  const error = lastReportError();
  const lines = [
    `time ${now.toISOString()}`,
    `game ${gameId}`,
    `build ${buildId ?? 'none'}`,
    `mode ${mode}`,
    `page ${location.pathname}`,
    `screen ${window.innerWidth}x${window.innerHeight}`,
    `agent ${navigator.userAgent}`,
    `bridge ${frame.bridgeState}${frame.errorCode ? ` (${frame.errorCode})` : ''}`,
    frame.error ? `bridge error ${frame.error}` : undefined,
    frame.load
      ? `load ${frame.load.phase} ${frame.load.loaded}/${frame.load.total}${frame.load.done ? ' done' : ''}`
      : undefined,
    `dropped ${frame.dropped}`,
    error ? `last error ${error.type}: ${error.message}` : undefined,
    ...(error?.frames ?? []).map((line) => `  ${line}`),
  ];
  return lines.filter((line): line is string => line !== undefined).join('\n');
}
