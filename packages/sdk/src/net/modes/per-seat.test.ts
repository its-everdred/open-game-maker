import type { ActionFrame, GameManifest, MultiplayerHooksV2 } from '@ogm/contracts';
import { describe, expect, it, vi } from 'vitest';

import { encodeBase64, packJson } from '../codec.js';
import { createNetController } from '../index.js';
import { ModeMismatchError, resolveAuthorityMode } from '../mode.js';
import { createFixtureGame } from '../test/fixture-game.js';
import { createLoopbackMatch } from '../test/loopback.js';

const perSeatManifest = {
  inputs: { actions: { move: 'axis', jump: 'button' } },
  net: { authority: 'per-seat', maxSeats: 4 },
} as unknown as GameManifest;

const hostManifest = { inputs: { actions: {} } } as unknown as GameManifest;

function match(seats = 2, latencyMs = 20, extra: Partial<Parameters<typeof createLoopbackMatch>[0]> = {}) {
  const games = Array.from({ length: seats }, () => createFixtureGame([0, 1]));
  const loopback = createLoopbackMatch({
    manifest: perSeatManifest,
    seats,
    game: (seat) => games[seat]!,
    link: { latencyMs },
    ...extra,
  });
  return { loopback, games };
}

describe('per-seat authority mode', () => {
  it('agrees on the digest at every tick of a clean link', () => {
    const { loopback, games } = match();
    loopback.start();
    let mismatches = 0;
    for (let tick = 0; tick < 600; tick += 1) {
      loopback.advance(1);
      if (loopback.seat(0).net.digest().join() !== loopback.seat(1).net.digest().join()) mismatches += 1;
    }

    expect(mismatches).toBe(0);
    for (const seat of [0, 1]) {
      expect(loopback.stats(seat)).toMatchObject({
        mode: 'per-seat',
        inputGaps: 0,
        lateInputs: 0,
        recoveries: 0,
        hardResyncs: 0,
        desyncs: 0,
        clockResyncs: 0,
        desynced: false,
      });
    }
    expect(games[0]!.shared()).toEqual(games[1]!.shared());
    expect(games[0]!.tick()).toBe(597);
  });

  it('applies the local seat input in its own step, whatever the round trip', () => {
    for (const latencyMs of [20, 80]) {
      const { loopback, games } = match(2, latencyMs);
      loopback.start();
      loopback.advance(200);

      for (const [seat, game] of games.entries()) {
        const ownTicks = game.steps.filter((step) => step.frames.some((frame) => frame.playerIndex === seat));
        expect(ownTicks.length).toBe(game.steps.length);
        for (const step of ownTicks) {
          expect(step.frames.filter((frame) => frame.playerIndex === seat).length).toBe(1);
        }
      }
      // The measurement itself never moves with RTT: there is no round trip in the path.
      expect(loopback.stats(0).localResponseMs).toBe(0);
      expect(loopback.stats(1).localResponseMs).toBe(0);
    }
  });

  it('detects a corrupted shared state, asks for a recovery and applies the answer', () => {
    const { loopback, games } = match();
    loopback.start();
    loopback.advance(300);
    const before = loopback.stats(0).recoveries + loopback.stats(1).recoveries;

    loopback.corrupt(1, 1);
    loopback.advance(40);

    const after = loopback.stats(0).recoveries + loopback.stats(1).recoveries;
    expect(after).toBeGreaterThan(before);
    expect(loopback.stats(1).recoveries).toBeGreaterThan(0);
    // The primary is the arbiter, so it answers rather than asking.
    expect(loopback.stats(0).recoveries).toBe(0);
    expect(loopback.stats(0).desyncs).toBeGreaterThan(0);
    expect(games[1]!.restores()).toBeGreaterThan(0);
    for (const seat of [0, 1]) {
      expect(loopback.stats(seat)).toMatchObject({ hardResyncs: 0, desynced: false });
    }
  });

  it('keeps run-length gaps out of a 5 % loss window and never hard resyncs', () => {
    const { loopback } = match(2, 20, { link: { latencyMs: 20, lossPct: 5, seed: 7 } });
    loopback.start();
    loopback.advance(900);

    for (const seat of [0, 1]) {
      const stats = loopback.stats(seat);
      // A tick gaps only when all three covering packets are lost, so a 5 % link leaves a handful at most.
      expect(stats.inputGaps).toBeLessThan(120);
      expect(stats.hardResyncs).toBe(0);
      expect(stats.desynced).toBe(false);
    }
    expect(loopback.stats(0).desyncs + loopback.stats(1).desyncs).toBeGreaterThan(0);
  });

  it('hands every seat the same shared stream and its own seat stream', () => {
    const { loopback } = match();
    loopback.start();
    loopback.advance(1);

    const shared = loopback.seat(0).net.rng('shared');
    const sameShared = loopback.seat(1).net.rng('shared');
    expect([shared.next(), shared.next()]).toEqual([sameShared.next(), sameShared.next()]);
    expect(loopback.seat(1).net.rng(1).next()).not.toBe(loopback.seat(0).net.rng(0).next());
    expect(loopback.seat(0).net.epoch).toBe('epoch-1');
    expect(loopback.seat(0).net.started).toBe(true);
    expect(loopback.seat(0).net.localSeat).toBe(0);
  });

  it('exposes the tick-stamped frame it holds for a seat', () => {
    const { loopback } = match();
    loopback.start();
    loopback.advance(30);
    const tick = loopback.seat(0).game.steps.at(-1)!.tick;
    const frame = loopback.seat(0).net.frameFor(1, tick);
    expect(frame?.playerIndex).toBe(1);
    expect(frame?.tick).toBe(tick);
  });

  it('preserves the running tick when the same epoch is announced on reconnect', () => {
    const { loopback } = match();
    loopback.start();
    loopback.advance(30);
    const seat = loopback.seat(0);
    const tick = seat.net.tick;
    const onStart = vi.fn();
    seat.net.onStart(onStart);
    seat.controller.handleMessage('net.start', {
      epoch: seat.net.epoch,
      mode: 'per-seat',
      seed: 1,
      startAt: 999_999,
      primarySeat: 0,
      seats: seat.net.seats,
    });
    expect(seat.net.tick).toBe(tick);
    expect(onStart).not.toHaveBeenCalled();
    expect(seat.net.started).toBe(true);
    loopback.advance(1);
    expect(seat.net.tick).toBe(tick + 1);
  });

  it('delivers events from different seats independently', () => {
    const { loopback } = match(3);
    loopback.start();
    const received = vi.fn();
    loopback.seat(0).net.onEvent(received);
    loopback.seat(1).net.sendEvent({ seat: 1 });
    loopback.seat(2).net.sendEvent({ seat: 2 });
    loopback.advance(2);
    expect(received).toHaveBeenCalledWith({ seat: 1 });
    expect(received).toHaveBeenCalledWith({ seat: 2 });
  });

  it('stamps events as lobby events once the room ends the epoch', () => {
    const { loopback } = match(2);
    loopback.start();
    const seat = loopback.seat(1);
    seat.controller.handleMessage('net.epoch.end', { epoch: seat.net.epoch, tick: seat.net.tick });
    seat.net.sendEvent({ rematch: true });
    loopback.advance(2);
    const sent = loopback.messages().filter((message) => message.type === 'net.event' && message.sender === 1);
    /* The room drops an event stamped with an epoch that is no longer running; between rounds it is a lobby event. */
    expect(sent.at(-1)?.payload).toMatchObject({ epoch: 'lobby' });
  });

  it('delivers events from a seat whose reloaded SDK restarted its sequence', () => {
    const { loopback } = match(2);
    loopback.start();
    const received = vi.fn();
    loopback.seat(0).net.onEvent(received);
    const event = (seq: number, value: unknown) => ({
      epoch: loopback.seat(0).net.epoch,
      id: `1-${seq}`,
      seq,
      from: 1,
      target: 'all',
      data: encodeBase64(packJson(value, 1024, 'event')),
    });
    loopback.seat(0).controller.handleMessage('net.event', event(5, { before: true }));
    loopback.seat(0).controller.handleMessage('net.event', event(1, { afterReload: true }));
    expect(received).toHaveBeenCalledWith({ afterReload: true });
  });
});

describe('authority mode selection', () => {
  it('resolves a missing manifest.net to host authority', () => {
    expect(resolveAuthorityMode(hostManifest)).toBe('host');
    expect(resolveAuthorityMode(perSeatManifest)).toBe('per-seat');
  });

  function controller(manifest: GameManifest, hooks: MultiplayerHooksV2) {
    return createNetController({
      manifest,
      hooks,
      localPlayerIndex: 0,
      send: () => undefined,
      acceptInput: () => undefined,
      syncPlayers: () => undefined,
      setLocalPlayerIndex: () => undefined,
      recordEvent: () => undefined,
      now: () => 0,
    });
  }

  it('uses the room-assigned local seat before an epoch starts', () => {
    const net = controller(perSeatManifest, createFixtureGame([0, 1]));
    net.handleMessage('net.players', {
      local: 1,
      players: [
        { playerIndex: 0, name: 'A', connected: true },
        { playerIndex: 1, name: 'B', connected: true },
      ],
    });
    expect(net.net.localSeat).toBe(1);
  });

  it('uses the room clock sample for per-seat time', () => {
    const net = controller(perSeatManifest, createFixtureGame([0, 1]));
    net.handleMessage('net.clock', { clientMs: 1000, serverMs: 1110, rttMs: 20 });
    expect(net.net.now().offsetMs).toBe(100);
  });

  it('refuses a per-seat manifest whose hooks are missing the three v2 calls', () => {
    const game = createFixtureGame([0, 1]);
    expect(() =>
      controller(perSeatManifest, { ...game, capture: undefined, restore: undefined, digest: undefined }),
    ).toThrow(ModeMismatchError);
    try {
      controller(perSeatManifest, { ...game, digest: undefined });
    } catch (error) {
      expect((error as ModeMismatchError).code).toBe('MODE_MISMATCH');
    }
  });

  it('refuses a rollback manifest until its ticket lands, and builds host mode without net', () => {
    const game = createFixtureGame([0, 1]);
    const rollback = { ...perSeatManifest, net: { authority: 'rollback', maxSeats: 2 } } as GameManifest;
    expect(() => controller(rollback, game)).toThrow(ModeMismatchError);

    const host = controller(hostManifest, game);
    expect(host.mode).toBe('host');
    expect(host.stepLocally).toBe(true);
    expect(host.net.mode).toBe('host');
    expect(host.net.started).toBe(false);
    expect(host.net.digest()).toEqual([]);
    expect(() => host.net.rng('shared')).toThrow('per-seat');
  });
});

describe('per-seat visibility', () => {
  function started(hooks: MultiplayerHooksV2, localPlayerIndex: number, send = vi.fn()) {
    // The room mints one private seed per seat; two seats never share one.
    const sent: { type: string; payload: unknown }[] = [];
    const controller = createNetController({
      manifest: perSeatManifest,
      hooks,
      localPlayerIndex,
      send: (type, payload) => {
        sent.push({ type, payload });
        send(type, payload);
      },
      acceptInput: () => undefined,
      syncPlayers: () => undefined,
      setLocalPlayerIndex: () => undefined,
      recordEvent: () => undefined,
      now: () => 1_000,
    });
    const seats = [
      { seat: 0, userId: 'a', name: 'A', team: 0, connected: true, ready: true, forfeited: false, spectator: false },
      { seat: 1, userId: 'b', name: 'B', team: 0, connected: true, ready: true, forfeited: false, spectator: false },
    ];
    controller.handleMessage('net.start', {
      epoch: 'epoch-1',
      seed: 12_345,
      startAt: 0,
      tick: 0,
      primary: 0,
      seats,
      privateSeed: 0x0f0f_0f0f + localPlayerIndex * 7_919,
    });
    return { controller, sent };
  }

  it('refuses a host-authoritative manifest that declares view', () => {
    const game = createFixtureGame([0, 1]);
    expect(() =>
      createNetController({
        manifest: hostManifest,
        hooks: { ...game, view: () => ({ tick: 0, state: {} }) } as MultiplayerHooksV2,
        localPlayerIndex: 0,
        send: () => undefined,
        acceptInput: () => undefined,
        syncPlayers: () => undefined,
        setLocalPlayerIndex: () => undefined,
        recordEvent: () => undefined,
        now: () => 0,
      }),
    ).toThrow(/VISIBILITY_REQUIRES_PER_SEAT/u);
  });

  it('ignores an addressed publish that was narrowed for another seat', () => {
    const game = createFixtureGame([0, 1], { localSeat: 0, secret: 'canary-7f3a' });
    const { controller } = started(game, 0);
    const state = btoa(JSON.stringify({ tick: 1, state: { seat: 1, p: 9 } }));

    // Addressed to seat 1: seat 0 must not apply a copy that was narrowed for someone else.
    controller.handleMessage('net.state', { epoch: 'epoch-1', seat: 1, seq: 1, tick: 1, to: 1, data: state }, 1);
    controller.beforeStep(1, []);
    controller.afterStep(1);
    controller.render();
    expect(game.owned(1).p).toBe(0);

    // Addressed to seat 0: this one is ours.
    controller.handleMessage('net.state', { epoch: 'epoch-1', seat: 1, seq: 2, tick: 1, to: 0, data: state }, 1);
    controller.beforeStep(1, []);
    controller.afterStep(1);
    controller.render();
    expect(game.owned(1).p).toBe(9);
  });

  it('answers a seat-scope recovery with what the requester may receive, addressed to it', () => {
    const game = createFixtureGame([0, 1], { localSeat: 1, secret: 'canary-7f3a' });
    const { controller, sent } = started(game, 1);

    controller.handleMessage('net.recovery.request', { epoch: 'epoch-1', scope: 'seat', tick: 10, seat: 1 }, 0);

    const answer = sent.find((message) => message.type === 'net.recovery');
    expect(answer).toBeDefined();
    const payload = answer!.payload as { to?: number; seat?: number; snapshot: string };
    expect(payload.to).toBe(0);
    expect(payload.seat).toBe(1);
    expect(atob(payload.snapshot)).not.toContain('canary-7f3a');
  });

  it('sends the shared slice alone, unfiltered, when view is in play', () => {
    const game = createFixtureGame([0, 1], { localSeat: 0, secret: 'canary-7f3a' });
    const { controller, sent } = started(game, 0);

    controller.handleMessage('net.recovery.request', { epoch: 'epoch-1', scope: 'shared', tick: 10 }, 1);

    const answers = sent.filter((message) => message.type === 'net.recovery');
    expect(answers.map((message) => (message.payload as { scope: string }).scope)).toEqual(['shared']);
  });

  it('seeds the private stream from this seat’s own private seed, not the shared one', () => {
    const left = createFixtureGame([0, 1]);
    const right = createFixtureGame([0, 1]);
    const seat0 = started(left, 0).controller;
    const seat1 = started(right, 1).controller;

    expect(seat0.net.rng('shared').next()).toBe(seat1.net.rng('shared').next());
    const seat0Private = [seat0.net.rng('private').next(), seat0.net.rng('private').next()];
    const seat1Private = [seat1.net.rng('private').next(), seat1.net.rng('private').next()];
    expect(seat0Private).not.toEqual(seat1Private);
    expect(() => seat0.net.rng('private')).not.toThrow();
  });
});

describe('the loopback harness itself', () => {
  it('replays the same loss pattern from the same seed and only moves on virtual time', () => {
    const run = (seed: number) => {
      const seen: string[] = [];
      const games = [createFixtureGame([0, 1]), createFixtureGame([0, 1])];
      const loopback = createLoopbackMatch({
        manifest: perSeatManifest,
        seats: 2,
        game: (seat) => games[seat]!,
        link: { latencyMs: 20, lossPct: 10, seed },
        input(seat, tick): ActionFrame {
          seen.push(`${seat}:${tick}`);
          return { playerIndex: seat, tick, source: 'network', actions: { move: tick % 3 === 0 ? 1 : 0 } };
        },
      });
      loopback.start();
      loopback.advance(200);
      return {
        seen: seen.join(','),
        gaps: loopback.stats(0).inputGaps + loopback.stats(1).inputGaps,
        digest: loopback.seat(0).net.digest().join(),
      };
    };

    expect(run(3)).toEqual(run(3));
    expect(run(3).gaps).not.toBe(run(4).gaps);
  });
});
