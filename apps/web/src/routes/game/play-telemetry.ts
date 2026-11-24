import { useCallback, useEffect, useRef } from 'react';

import type { CrashKind, GameFault, PlayStep } from '@ogm/contracts/browser';

import type { GameFrameState } from '../../features/editor/frame';
import { breadcrumb, reportCrash, track } from '../../features/telemetry/telemetry';

const FAULT_CRASH: Record<GameFault['kind'], CrashKind> = {
  error: 'game_error',
  rejection: 'game_rejection',
  csp: 'csp_violation',
  asset: 'asset_load_failed',
  webgl: 'webgl_context_lost',
};
// The bridge never came up: the game's script did not run or did not answer.
const BRIDGE_TIMEOUTS = new Set(['ready-timeout', 'bridge-connect']);

export function playStep(state: Pick<GameFrameState, 'bridgeState' | 'firstFrame' | 'load'>): PlayStep {
  if (state.firstFrame && state.load?.done) return 'in-world';
  if (state.firstFrame) return 'play';
  return state.bridgeState === 'connecting' ? 'loading' : 'title';
}

/**
 * Reports one game's play: first-frame and in-world heartbeats per mount, the "Try again" overlay, and the faults the
 * game frame relays. `failed` is the overlay's own condition.
 */
export function usePlayTelemetry(input: {
  gameId: string;
  buildId: string | undefined;
  frameState: GameFrameState;
  failed: boolean;
  designLoadFailed: boolean;
}) {
  const { gameId, buildId, frameState, failed, designLoadFailed } = input;
  const step = useRef<PlayStep>('loading');
  const lastStep = useRef<PlayStep | undefined>(undefined);
  step.current = failed ? (lastStep.current ?? 'loading') : playStep(frameState);
  if (!failed) lastStep.current = step.current;
  const ids = { gameId, ...(buildId ? { buildId } : {}) };
  const idsKey = `${gameId}|${buildId ?? ''}`;

  const sent = useRef({ key: '', firstFrame: false, inWorld: false });
  if (sent.current.key !== idsKey) sent.current = { key: idsKey, firstFrame: false, inWorld: false };

  useEffect(() => {
    if (gameId) breadcrumb(`open game ${gameId} build ${buildId ?? 'none'}`);
  }, [gameId, buildId]);

  useEffect(() => {
    breadcrumb(`bridge ${frameState.bridgeState}${frameState.errorCode ? ` ${frameState.errorCode}` : ''}`);
  }, [frameState.bridgeState, frameState.errorCode]);

  const current = step.current;
  useEffect(() => {
    if (!gameId) return;
    if ((current === 'play' || current === 'in-world') && !sent.current.firstFrame) {
      sent.current.firstFrame = true;
      breadcrumb('first frame');
      track({ kind: 'first_frame', ...ids });
    }
    if (current === 'in-world' && !sent.current.inWorld) {
      sent.current.inWorld = true;
      breadcrumb('in world');
      track({ kind: 'in_world', ...ids });
    }
    // `ids` is derived from gameId/buildId, both covered by idsKey.
  }, [current, idsKey]);

  useEffect(() => {
    if (!failed || !gameId) return;
    const code = designLoadFailed ? 'design-load-failed' : (frameState.errorCode ?? 'frame-error');
    reportCrash({
      crash: BRIDGE_TIMEOUTS.has(code) ? 'bridge_timeout' : 'try_again',
      message: frameState.error ? `${code}: ${frameState.error}` : code,
      step: step.current,
      ...ids,
    });
    // Report each time the overlay appears, not on unrelated state changes while it shows.
  }, [failed, idsKey]);

  const reportFault = useCallback(
    (fault: GameFault) =>
      reportCrash({
        crash: FAULT_CRASH[fault.kind],
        message: fault.message,
        ...(fault.stack ? { stack: fault.stack } : {}),
        step: step.current,
        gameId,
        ...(buildId ? { buildId } : {}),
      }),
    [gameId, buildId],
  );
  const reportRestoreError = useCallback(
    (error: unknown) =>
      reportCrash({
        crash: 'save_restore_failed',
        message: `Could not restore save: ${error instanceof Error ? error.message : String(error)}`,
        step: step.current,
        gameId,
        ...(buildId ? { buildId } : {}),
      }),
    [gameId, buildId],
  );
  return { reportFault, reportRestoreError };
}
