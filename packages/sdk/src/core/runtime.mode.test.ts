import type { ActionFrame, GameInstance, GameManifest, MultiplayerHooksV2 } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { FixedClock } from './clock.js';
import { EventRing } from './events.js';
import type { SdkHostApi } from './host-api.js';
import { RuntimeImpl } from './runtime.js';
import { createNetController, type NetController } from '../net/index.js';

const perSeatManifest = {
  inputs: { actions: { move: 'axis' } },
  net: { authority: 'per-seat', maxSeats: 2 },
} as unknown as GameManifest;
const hostManifest = { inputs: { actions: { move: 'axis' } } } as unknown as GameManifest;

const hooks: MultiplayerHooksV2 = {
  spawn() {},
  despawn() {},
  snapshot: () => ({ tick: 0, state: {} }),
  applySnapshot() {},
  hud: () => ({}),
  capture: () => ({ tick: 0, state: {} }),
  restore() {},
  digest: () => [0],
};

function harness(manifest: GameManifest) {
  const dispatched: ActionFrame[][] = [];
  const steps: number[] = [];
  const sent: { type: string; payload: unknown }[] = [];
  const clock = new FixedClock();
  const runtime = new RuntimeImpl(
    { net: hooks } as unknown as GameInstance<unknown, unknown>,
    {
      dispatchInput: (frames: ActionFrame[]) => dispatched.push([...frames]),
      settings: { onChange: () => () => undefined },
    } as unknown as SdkHostApi,
    'draft',
    'play',
    new EventRing(),
    () => undefined,
    clock,
  );
  const time = { now: 0 };
  const controller = createNetController({
    manifest,
    hooks,
    localPlayerIndex: 1,
    send: (type, payload) => sent.push({ type, payload }),
    acceptInput: () => undefined,
    syncPlayers: () => undefined,
    setLocalPlayerIndex: () => undefined,
    recordEvent: () => undefined,
    now: () => time.now,
    pauseClock: () => runtime.clock.pause(),
    resumeClock: () => runtime.clock.resume(),
    resetClock: (tick) => runtime.clock.reset(tick),
  });
  runtime.installNet(controller);
  runtime.onStep(() => steps.push(runtime.clock.tick));
  return { runtime, controller: controller as NetController, dispatched, steps, sent, time };
}

const start = () => ({
  epoch: 'epoch-1',
  mode: 'per-seat' as const,
  seed: 1,
  startAt: 0,
  primarySeat: 0,
  seats: [0, 1].map((seat) => ({
    seat,
    userId: `u${seat}`,
    name: `P${seat}`,
    team: 0,
    connected: true,
    ready: true,
    forfeited: false,
    spectator: false,
  })),
});

describe('the runtime seam', () => {
  it('keeps a host-mode peer rendering: its step listener never runs the game step', () => {
    const { runtime, controller, dispatched, steps } = harness(hostManifest);
    expect(controller.mode).toBe('host');
    expect(controller.stepLocally).toBe(true);

    controller.handleMessage('net.role', { role: 'peer' });
    expect(controller.stepLocally).toBe(false);
    runtime.advance(100);

    expect(steps).toEqual([]);
    expect(dispatched).toEqual([]);
    expect(runtime.clock.tick).toBeGreaterThan(0);
  });

  it('lets every seat simulate in per-seat mode, whichever role it holds', () => {
    const { runtime, controller, dispatched, steps } = harness(perSeatManifest);
    expect(controller.mode).toBe('per-seat');
    expect(controller.stepLocally).toBe(true);

    controller.handleMessage('net.role', { role: 'peer' });
    expect(controller.stepLocally).toBe(true);
    controller.handleMessage('net.start', start());
    runtime.advance(100);

    expect(steps.length).toBeGreaterThan(0);
    expect(dispatched.length).toBe(steps.length);
  });

  it('opens the start gate from a paused clock, before any step can run', () => {
    const { runtime, controller, steps, time } = harness(perSeatManifest);
    controller.handleMessage('net.start', { ...start(), startAt: 10_000 });
    expect(runtime.clock.paused).toBe(true);

    for (let elapsed = 0; elapsed < 10_100; elapsed += 100) {
      time.now = elapsed;
      runtime.advance(100);
    }

    expect(runtime.clock.paused).toBe(false);
    expect(steps.length).toBeGreaterThan(0);
    expect(controller.net.started).toBe(true);
    expect(controller.net.tick).toBeGreaterThan(0);
  });
});
