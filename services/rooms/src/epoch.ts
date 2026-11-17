import { randomInt, randomUUID } from 'node:crypto';

import { LIMITS_V2, SIM_TICK_HZ } from '@ogm/contracts';

/*
 * The epoch and the tick the room can publish without simulating (#497 §3.3, D-N3-4).
 *
 * The tick is derived from the earlier of now and a scheduled `pausedAt`, less `startAt`. A resume shifts
 * `startAt` by the paused duration, so the derived tick freezes and continues
 * with no counter to reconcile. Nothing here runs a clock forward or steps a simulation.
 */

export type EpochClock = { startAt: number; pausedAt: number };
export type SeatReadiness = { userId: string; connected: boolean; ready: boolean; forfeited: boolean };

export function mintEpoch(input: { now: number; primarySeat: number; leadMs?: number; seed?: number }) {
  return {
    epoch: randomUUID(),
    startAt: input.now + (input.leadMs ?? LIMITS_V2.startLeadMs),
    pausedAt: 0,
    primarySeat: input.primarySeat,
    seed: input.seed ?? randomInt(0, 2 ** 32),
  };
}

export function tickAt(clock: EpochClock, now: number): number {
  const elapsed = (clock.pausedAt === 0 ? now : Math.min(now, clock.pausedAt)) - clock.startAt;
  return Math.max(0, Math.floor((elapsed * SIM_TICK_HZ) / 1_000));
}

export function pauseAt(clock: EpochClock, now: number): EpochClock {
  return { startAt: clock.startAt, pausedAt: now };
}

/** Shifts `startAt` by the paused duration so the tick after a resume continues from the paused one. */
export function resumeAt(clock: EpochClock, now: number): EpochClock {
  if (clock.pausedAt === 0) return clock;
  return { startAt: clock.startAt + (now - clock.pausedAt), pausedAt: 0 };
}

/** Every occupied, connected, non-forfeited seat is ready, and at least one such seat exists. */
export function canStart(seats: readonly SeatReadiness[]): boolean {
  const live = seats.filter((seat) => seat.userId !== '' && seat.connected && !seat.forfeited);
  return live.length > 0 && live.every((seat) => seat.ready);
}

/** A per-seat stream seed: `hash(sharedSeed, seat)`, always minted, so the room never reads a manifest. */
export function privateSeedFor(seed: number, seat: number): number {
  let mixed = (seed ^ Math.imul(seat + 1, 0x9e_37_79_b1)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85_eb_ca_6b) >>> 0;
  return (mixed ^ (mixed >>> 15)) >>> 0;
}
