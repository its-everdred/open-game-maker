import { describe, expect, it } from 'vitest';

import type { NetClientMessage } from '@ogm/contracts';

import { recipientsFor, type SeatRecord } from '../src/routing.js';

const epoch = '6f1c0f7e-0d2b-4a1e-9d54-2b6a1c9c3f11';

/* Four seats, teams 0/1/0/1, plus one spectator — the table of #497 §6.3. */
const seats: SeatRecord[] = [
  { seat: 0, userId: 'owner', team: 0, connected: true, forfeited: false, sessions: ['s0'] },
  { seat: 1, userId: 'p1', team: 1, connected: true, forfeited: false, sessions: ['s1'] },
  { seat: 2, userId: 'p2', team: 0, connected: true, forfeited: false, sessions: ['s2'] },
  { seat: 3, userId: 'p3', team: 1, connected: true, forfeited: false, sessions: ['s3'] },
];
const spectators = [{ userId: 'watcher', sessions: ['sw'] }];

const event = (overrides: Partial<Extract<NetClientMessage, { t: 'net.event' }>> = {}) =>
  ({
    t: 'net.event',
    epoch,
    id: 'ev_1',
    seq: 1,
    from: 0,
    target: 'all',
    data: 'AQ==',
    ...overrides,
  }) as NetClientMessage;

const route = (message: NetClientMessage, senderSeat = 0) =>
  recipientsFor({ message, senderSessionId: `s${senderSeat}`, senderSeat, seats, spectators, primarySeat: 0 });

describe('routing', () => {
  it('sends an all-target event to every other seat and every spectator', () => {
    expect(route(event()).sessions.sort()).toEqual(['s1', 's2', 's3', 'sw']);
  });

  it('sends a seat-target event to that seat only, never back to the sender', () => {
    expect(route(event({ target: 'seat', to: 1 })).sessions).toEqual(['s1']);
    expect(route(event({ target: 'seat', to: 0 })).sessions).toEqual([]);
  });

  it('sends a team-target event to the other members of that team', () => {
    expect(route(event({ target: 'team', team: 0 })).sessions).toEqual(['s2']);
    expect(route(event({ target: 'team', team: 1 })).sessions).toEqual(['s1', 's3']);
    expect(route(event({ target: 'team', team: 5 })).drop).toBe('TEAM_UNKNOWN');
    expect(route(event({ target: 'team' })).drop).toBe('TEAM_UNKNOWN');
  });

  it('refuses a seat target outside the table', () => {
    expect(route(event({ target: 'seat', to: 7 }))).toEqual({ sessions: [], drop: 'SEAT_OUT_OF_RANGE' });
    expect(route(event({ target: 'seat' }))).toEqual({ sessions: [], drop: 'SEAT_OUT_OF_RANGE' });
  });

  it('drops every routed message from a spectator', () => {
    const result = recipientsFor({
      message: event(),
      senderSessionId: 'sw',
      senderSeat: undefined,
      seats,
      spectators,
      primarySeat: 0,
    });
    expect(result).toEqual({ sessions: [], drop: 'SPECTATOR_NOT_SEATED' });
  });

  it('relays inputs, state, checksums and recovery to the other seats and never to a spectator', () => {
    const inputs = {
      t: 'net.inputs',
      epoch,
      seat: 1,
      firstTick: 4,
      frames: [{ seq: 1, tick: 4, axes: [], buttons: 0 }],
    } as NetClientMessage;
    expect(route(inputs, 1).sessions.sort()).toEqual(['s0', 's2', 's3']);

    const state = { t: 'net.state', epoch, seat: 1, seq: 2, tick: 5, data: 'AQ==' } as NetClientMessage;
    expect(route(state, 1).sessions.sort()).toEqual(['s0', 's2', 's3']);

    const checksum = { t: 'net.checksum', epoch, scope: 'shared', tick: 5, sum: 1 } as NetClientMessage;
    expect(route(checksum, 1).sessions.sort()).toEqual(['s0', 's2', 's3']);
  });

  it('routes recovery requests to the arbiter and signals to one seat', () => {
    expect(
      route({ t: 'net.recovery.request', epoch, scope: 'shared', tick: 9 } as NetClientMessage, 1).sessions,
    ).toEqual(['s0']);
    expect(
      route({ t: 'net.recovery.request', epoch, scope: 'events', tick: 9, seat: 3 } as NetClientMessage, 1).sessions,
    ).toEqual(['s3']);
    expect(route({ t: 'net.signal', epoch, to: 3, data: 'AQ==' } as NetClientMessage, 0).sessions).toEqual(['s3']);
  });

  it('delivers addressed state and recovery only to the intended seat', () => {
    expect(route({ t: 'net.state', epoch, seat: 0, seq: 1, tick: 5, to: 1, data: 'AQ==' }).sessions).toEqual(['s1']);
    expect(route({ t: 'net.recovery', epoch, scope: 'seat', tick: 5, to: 2 }).sessions).toEqual(['s2']);
    expect(route({ t: 'net.state', epoch, seat: 0, seq: 1, tick: 5, to: 7, data: 'AQ==' }).drop).toBe(
      'SEAT_OUT_OF_RANGE',
    );
  });
});
