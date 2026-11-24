import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameFrameState } from '../../features/editor/frame';
import { playStep, usePlayTelemetry } from './play-telemetry';

const telemetry = vi.hoisted(() => ({ track: vi.fn(), reportCrash: vi.fn(), breadcrumb: vi.fn() }));
vi.mock('../../features/telemetry/telemetry', () => telemetry);

const gameId = 'g_dusk';
const buildId = 'b_7';
const connecting: GameFrameState = { bridgeState: 'connecting', dropped: 0 };
const playing: GameFrameState = { bridgeState: 'ready', dropped: 0, firstFrame: true };
const inWorld: GameFrameState = {
  ...playing,
  load: { phase: 'ready', loaded: 1, total: 1, done: true },
};

function render(frameState: GameFrameState, failed = false) {
  return renderHook(
    (props: { frameState: GameFrameState; failed: boolean }) =>
      usePlayTelemetry({ gameId, buildId, designLoadFailed: false, ...props }),
    {
      initialProps: { frameState, failed },
    },
  );
}

beforeEach(() => vi.clearAllMocks());

describe('playStep', () => {
  it('walks loading → title → play → in-world', () => {
    expect(playStep(connecting)).toBe('loading');
    expect(playStep({ ...connecting, bridgeState: 'ready' })).toBe('title');
    expect(playStep({ ...connecting, bridgeState: 'error', errorCode: 'ready-timeout' })).toBe('loading');
    expect(playStep(playing)).toBe('play');
    expect(playStep(inWorld)).toBe('in-world');
  });
});

describe('usePlayTelemetry', () => {
  /* Heartbeats give success rates: crashes alone cannot say how often a game works. */
  it('sends first-frame and in-world heartbeats once per game build', () => {
    const hook = render(connecting);
    hook.rerender({ frameState: playing, failed: false });
    hook.rerender({ frameState: inWorld, failed: false });
    hook.rerender({ frameState: { ...inWorld, dropped: 3 }, failed: false });
    expect(telemetry.track.mock.calls.map(([event]) => event)).toEqual([
      { kind: 'first_frame', gameId, buildId },
      { kind: 'in_world', gameId, buildId },
    ]);
  });

  /* The old build's state lingers until the new frame publishes; it must not vouch for or blame the new build. */
  it('reports nothing for a new build from the previous build’s frame state', () => {
    const hook = renderHook(
      (props: { buildId: string; frameState: GameFrameState; failed: boolean }) =>
        usePlayTelemetry({ gameId, designLoadFailed: false, ...props }),
      { initialProps: { buildId: 'b_old', frameState: inWorld, failed: false } },
    );
    const broken: GameFrameState = { ...playing, bridgeState: 'error', errorCode: 'boot_failed' };
    hook.rerender({ buildId: 'b_old', frameState: broken, failed: true });
    vi.clearAllMocks();

    hook.rerender({ buildId: 'b_new', frameState: broken, failed: true });
    expect(telemetry.track).not.toHaveBeenCalled();
    expect(telemetry.reportCrash).not.toHaveBeenCalled();

    hook.rerender({ buildId: 'b_new', frameState: connecting, failed: false });
    hook.rerender({ buildId: 'b_new', frameState: inWorld, failed: false });
    expect(telemetry.track.mock.calls.map(([event]) => event)).toEqual([
      { kind: 'first_frame', gameId, buildId: 'b_new' },
      { kind: 'in_world', gameId, buildId: 'b_new' },
    ]);
  });

  it('reports the "Try again" overlay with the step the player reached', () => {
    const hook = render(playing);
    hook.rerender({
      frameState: { ...playing, bridgeState: 'error', errorCode: 'boot_failed', error: 'TypeError: helm' },
      failed: true,
    });
    expect(telemetry.reportCrash).toHaveBeenCalledWith({
      crash: 'try_again',
      message: 'boot_failed: TypeError: helm',
      step: 'play',
      gameId,
      buildId,
    });
  });

  it('names a game that never answered the bridge a bridge timeout', () => {
    const hook = render(connecting);
    hook.rerender({ frameState: { ...connecting, bridgeState: 'error', errorCode: 'ready-timeout' }, failed: true });
    expect(telemetry.reportCrash).toHaveBeenCalledWith(
      expect.objectContaining({ crash: 'bridge_timeout', step: 'loading' }),
    );
  });

  /* The shell hides a first ready timeout behind one silent reload; the slow boot is still worth knowing about. */
  it('reports a ready timeout the shell reloads silently', () => {
    const hook = render(connecting);
    hook.rerender({ frameState: { ...connecting, bridgeState: 'error', errorCode: 'ready-timeout' }, failed: false });
    expect(telemetry.reportCrash).toHaveBeenCalledWith(
      expect.objectContaining({ crash: 'bridge_timeout', message: 'ready-timeout (reloading once)', step: 'loading' }),
    );
  });

  it('maps relayed game faults and save restore failures to crash kinds', () => {
    const hook = render(inWorld);
    hook.result.current.reportFault({ kind: 'csp', message: 'script-src blocked https://cdn.example/r.js' });
    hook.result.current.reportFault({ kind: 'webgl', message: 'WebGL context lost' });
    hook.result.current.reportRestoreError(new Error('save restore timed out'));
    expect(telemetry.reportCrash.mock.calls.map(([event]) => [event.crash, event.step, event.message])).toEqual([
      ['csp_violation', 'in-world', 'script-src blocked https://cdn.example/r.js'],
      ['webgl_context_lost', 'in-world', 'WebGL context lost'],
      ['save_restore_failed', 'in-world', 'Could not restore save: save restore timed out'],
    ]);
  });
});
