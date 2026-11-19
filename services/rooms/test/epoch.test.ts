import { describe, expect, it } from 'vitest';

import { LIMITS_V2, SIM_TICK_HZ } from '@ogm/contracts';

import { canStart, mintEpoch, pauseAt, privateSeedFor, resumeAt, tickAt } from '../src/epoch.js';

const startAt = 1_000_000;

describe('epoch', () => {
  it('derives the tick from startAt at the simulation rate', () => {
    expect(SIM_TICK_HZ).toBe(60);
    expect(tickAt({ startAt, pausedAt: 0 }, startAt)).toBe(0);
    expect(tickAt({ startAt, pausedAt: 0 }, startAt + 1_000)).toBe(60);
    expect(tickAt({ startAt, pausedAt: 0 }, startAt + 100)).toBe(6);
    expect(tickAt({ startAt, pausedAt: 0 }, startAt - 50)).toBe(0);
  });

  it('freezes the tick while paused and continues from it after a resume', () => {
    const paused = pauseAt({ startAt, pausedAt: 0 }, startAt + 500);
    expect(paused.pausedAt).toBe(startAt + 500);
    expect(tickAt(paused, startAt + 500)).toBe(30);
    expect(tickAt(paused, startAt + 9_000)).toBe(30);

    const resumed = resumeAt(paused, startAt + 9_000);
    expect(resumed.pausedAt).toBe(0);
    expect(resumed.startAt).toBe(startAt + 8_500);
    expect(tickAt(resumed, startAt + 9_000)).toBe(30);
    expect(tickAt(resumed, startAt + 10_000)).toBe(90);
  });

  it('continues advancing until a scheduled pause boundary', () => {
    const clock = { startAt, pausedAt: startAt + 1_000 };
    expect(tickAt(clock, startAt + 500)).toBe(30);
    expect(tickAt(clock, startAt + 2_000)).toBe(60);
  });

  it('mints a lead ahead of now, a seed and a primary seat', () => {
    const minted = mintEpoch({ now: startAt, primarySeat: 2, seed: 7 });
    expect(minted.startAt).toBe(startAt + LIMITS_V2.startLeadMs);
    expect(minted.pausedAt).toBe(0);
    expect(minted.primarySeat).toBe(2);
    expect(minted.seed).toBe(7);
    expect(minted.epoch).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(mintEpoch({ now: startAt, primarySeat: 0 }).epoch).not.toBe(minted.epoch);
  });

  it('starts only when every occupied, connected, non-forfeited seat is ready', () => {
    const live = { userId: 'a', connected: true, ready: true, forfeited: false };
    expect(canStart([live, { ...live, userId: 'b', ready: true }])).toBe(true);
    expect(canStart([live, { ...live, userId: 'b', ready: false }])).toBe(false);
    expect(canStart([live, { ...live, userId: 'b', connected: false, ready: false }])).toBe(true);
    expect(canStart([live, { ...live, userId: 'b', forfeited: true, ready: false }])).toBe(true);
    expect(canStart([live, { ...live, userId: '', ready: false }])).toBe(true);
    expect(canStart([{ userId: '', connected: true, ready: true, forfeited: false }])).toBe(false);
  });

  it('mints a distinct, stable private seed per seat', () => {
    const seeds = [0, 1, 2, 3].map((seat) => privateSeedFor(1234, seat));
    expect(new Set(seeds).size).toBe(4);
    expect(privateSeedFor(1234, 3)).toBe(seeds[3]);
    expect(privateSeedFor(1235, 3)).not.toBe(seeds[3]);
  });
});
