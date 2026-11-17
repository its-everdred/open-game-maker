import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Harness, connect, joinOptions, newRoom, rejectionCode, sleep, startHarness, waitFor } from './helpers.js';

let harness: Harness;

describe('match pause', () => {
  beforeAll(async () => {
    harness = await startHarness();
  });
  afterEach(async () => {
    await harness.testServer.cleanup();
  });
  afterAll(async () => {
    await harness.testServer.shutdown();
  });

  it('relays per-seat lobby events before an epoch starts', async () => {
    const room = await newRoom(harness.testServer, { protocol: 2, mode: 'per-seat', maxPlayers: 2 });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    const incoming = owner.waitForMessage('net.event');
    peer.send('net.event', { epoch: 'lobby', id: '1-1', seq: 1, from: 1, target: 'all', data: 'e30=' });
    expect(await incoming).toMatchObject({ epoch: 'lobby', from: 1, seq: 1 });
  });

  it('broadcasts the pauser and resumes both seats after a shared countdown', async () => {
    const room = await newRoom(harness.testServer, { protocol: 2, maxPlayers: 2 });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('phase', { to: 'playing' });
    await waitFor(() => room.state.phase === 'playing', 'playing');
    const ownerPause = owner.waitForMessage('match.pause');
    const peerPause = peer.waitForMessage('match.pause');
    peer.send('match.pause.request', {});
    expect(await ownerPause).toMatchObject({ by: 'p1', name: 'p1' });
    expect(await peerPause).toMatchObject({ by: 'p1', name: 'p1' });
    const ownerResume = owner.waitForMessage('match.resume');
    const peerResume = peer.waitForMessage('match.resume');
    const before = Date.now();
    owner.send('match.resume.request', {});
    const [a, b] = await Promise.all([ownerResume, peerResume]);
    expect(a.at).toBe(b.at);
    expect(a.at - before).toBeGreaterThanOrEqual(2900);
    expect(room.state.matchPausedBy).toBe('p1');
    await waitFor(() => room.state.matchPausedBy === '', 'resume countdown', 4000);
  });

  it('ignores spectators and keeps a manual pause through a disconnect', async () => {
    const room = await newRoom(harness.testServer, {
      protocol: 2,
      maxPlayers: 2,
      spectators: 'on',
      timings: { seatReconnectSec: 2 },
    });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    const spectator = await connect(harness.testServer, room, 'viewer', 'player');
    owner.send('phase', { to: 'playing' });
    await waitFor(() => room.state.phase === 'playing', 'playing');
    spectator.send('match.pause.request', {});
    await sleep(60);
    expect(room.state.matchPausedBy).toBe('');
    peer.send('match.pause.request', {});
    await waitFor(() => room.state.matchPausedBy === 'p1', 'manual pause');
    await peer.leave(false);
    await waitFor(() => !room.state.seats[1].connected, 'offline');
    owner.send('match.resume.request', {});
    await sleep(60);
    expect(room.state.matchResumeAt).toBe(0);
    expect(room.state.matchPausedBy).toBe('p1');
  });

  it('forfeits a disconnected pauser after the configured window and starts the countdown', async () => {
    const room = await newRoom(harness.testServer, {
      protocol: 2,
      maxPlayers: 2,
      timings: { seatReconnectSec: 0.2 },
    });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('phase', { to: 'playing' });
    await waitFor(() => room.state.phase === 'playing', 'playing');
    peer.send('match.pause.request', {});
    await waitFor(() => room.state.matchPausedBy === 'p1', 'manual pause');
    await peer.leave(false);
    await waitFor(() => room.state.seats[1].forfeited, 'forfeit', 2_000);
    expect(room.state.matchPausedBy).toBe('p1');
    expect(room.state.matchResumeAt).toBeGreaterThan(Date.now());
  });

  it('only allows the pauser to resume a match with three players', async () => {
    const room = await newRoom(harness.testServer, { protocol: 2, maxPlayers: 3 });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    await connect(harness.testServer, room, 'p2', 'player');
    owner.send('phase', { to: 'playing' });
    await waitFor(() => room.state.phase === 'playing', 'playing');
    owner.send('match.pause.request', {});
    await waitFor(() => room.state.matchPausedBy === 'owner', 'manual pause');
    peer.send('match.resume.request', {});
    await sleep(60);
    expect(room.state.matchResumeAt).toBe(0);
    owner.send('match.resume.request', {});
    await waitFor(() => room.state.matchResumeAt > Date.now(), 'resume countdown');
  });

  it('rate-limits repeated pause requests', async () => {
    const room = await newRoom(harness.testServer, { protocol: 2, maxPlayers: 2 });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    owner.send('phase', { to: 'playing' });
    await waitFor(() => room.state.phase === 'playing', 'playing');
    for (let i = 0; i < 8; i += 1) owner.send('match.pause.request', {});
    await waitFor(() => (room.droppedCounts['match.pause.request'] ?? 0) > 0, 'rate limit');
    expect(room.state.matchPausedBy).toBe('owner');
  });

  it('cancels a countdown if a seat disconnects before it ends', async () => {
    const room = await newRoom(harness.testServer, { protocol: 2, maxPlayers: 2, timings: { seatReconnectSec: 2 } });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('phase', { to: 'playing' });
    await waitFor(() => room.state.phase === 'playing', 'playing');
    owner.send('match.pause.request', {});
    await waitFor(() => room.state.matchPausedBy === 'owner', 'manual pause');
    owner.send('match.resume.request', {});
    await waitFor(() => room.state.matchResumeAt > 0, 'resume countdown');
    await peer.leave(false);
    await waitFor(() => room.state.matchResumeAt === 0, 'cancelled countdown');
    expect(room.state.matchPausedBy).toBe('owner');
  });

  it('tells a rejoining client that the epoch is still paused for another offline seat', async () => {
    const room = await newRoom(harness.testServer, {
      protocol: 2,
      maxPlayers: 3,
      startLeadMs: 500,
      timings: { seatReconnectSec: 2 },
    });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    const other = await connect(harness.testServer, room, 'p2', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    await Promise.all([peer.leave(false), other.leave(false)]);
    await waitFor(() => !room.state.seats[1].connected && !room.state.seats[2].connected, 'both offline');
    const rejoined = await harness.testServer.sdk.joinById(room.roomId, await joinOptions(room, 'p1', 'player'));
    const pauses = vi.fn();
    rejoined.onMessage('net.pause', pauses);
    await waitFor(() => pauses.mock.calls.length === 1, 'rejoin pause');
    expect(pauses.mock.calls[0]?.[0]).toMatchObject({ epoch: room.state.epoch });
  });

  it('waits for every per-seat simulation to reach the shared pause tick before counting down', async () => {
    const room = await newRoom(harness.testServer, { protocol: 2, mode: 'per-seat', maxPlayers: 2, startLeadMs: 500 });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    const prepareOwner = owner.waitForMessage('net.pause.prepare');
    const preparePeer = peer.waitForMessage('net.pause.prepare');
    reportPositions(room, owner, peer);
    owner.send('match.pause.request', {});
    const [a, b] = await Promise.all([prepareOwner, preparePeer]);
    expect(a).toEqual(b);
    expect(room.state.pausedAt).toBeGreaterThan(Date.now());
    owner.send('match.resume.request', {});
    owner.send('net.pause.ack', a);
    await sleep(80);
    expect(room.state.matchResumeAt).toBe(0);
    peer.send('net.pause.ack', b);
    await waitFor(() => room.state.matchResumeAt > Date.now(), 'resume after acknowledgements');
  });

  it('chooses a pause boundary from the players’ simulation positions', async () => {
    const room = await newRoom(harness.testServer, { protocol: 2, mode: 'per-seat', maxPlayers: 2, startLeadMs: 500 });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(1200);
    const probeA = owner.waitForMessage('net.pause.probe');
    const probeB = peer.waitForMessage('net.pause.probe');
    const prepare = owner.waitForMessage('net.pause.prepare');
    owner.send('match.pause.request', {});
    const [a, b] = await Promise.all([probeA, probeB]);
    owner.send('net.pause.position', { epoch: a.epoch, tick: 5 });
    peer.send('net.pause.position', { epoch: b.epoch, tick: 8 });
    const target = await prepare;
    expect(target.tick).toBeGreaterThan(8);
    expect(target.tick).toBeLessThan(40);
  });

  it('waits for a disconnected player to report its position after reconnecting', async () => {
    const room = await newRoom(harness.testServer, {
      protocol: 2,
      mode: 'per-seat',
      maxPlayers: 2,
      startLeadMs: 500,
      timings: { seatReconnectSec: 3 },
    });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    const probe = owner.waitForMessage('net.pause.probe');
    const prepare = owner.waitForMessage('net.pause.prepare');
    owner.send('match.pause.request', {});
    const { epoch } = await probe;
    await peer.leave(false);
    await waitFor(() => !room.state.seats[1].connected, 'peer offline');
    owner.send('net.pause.position', { epoch, tick: 5 });
    /* The rejoin probes every seat again, so the boundary lead is measured from that probe, not the first one. */
    owner.onMessage('net.pause.probe', () => owner.send('net.pause.position', { epoch, tick: 5 }));
    const rejoined = await harness.testServer.sdk.joinById(room.roomId, await joinOptions(room, 'p1', 'player'));
    const probes = vi.fn();
    rejoined.onMessage('net.pause.probe', probes);
    await waitFor(() => probes.mock.calls.length === 1, 'rejoin probe');
    rejoined.send('net.pause.position', { epoch, tick: 6 });
    expect((await prepare).tick).toBeGreaterThan(6);
  });

  it('cancels a position probe when the match leaves play', async () => {
    const room = await newRoom(harness.testServer, { protocol: 2, mode: 'per-seat', maxPlayers: 2, startLeadMs: 500 });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    const probe = peer.waitForMessage('net.pause.probe');
    owner.send('match.pause.request', {});
    await probe;
    const resume = peer.waitForMessage('net.resume');
    owner.send('phase', { to: 'editing' });
    expect((await resume).epoch).toBe(room.state.epoch);
    await waitFor(() => room.state.matchPausedBy === '', 'cleared pause');
  });

  it('pauses a seat whose SDK predates the barrier at the room tick instead of sending it away', async () => {
    const room = await newRoom(harness.testServer, { protocol: 2, mode: 'per-seat', maxPlayers: 2, startLeadMs: 500 });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const legacy = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    reportPositions(room, owner);
    const paused = legacy.waitForMessage('net.pause', 4_000);
    owner.send('match.pause.request', {});
    expect((await paused).epoch).toBe(room.state.epoch);
    expect(room.state.pausedAt).toBeGreaterThan(0);
    expect(room.state.seats[1].connected).toBe(true);
    const resumed = legacy.waitForMessage('net.resume', 5_000);
    owner.send('match.resume.request', {});
    expect((await resumed).epoch).toBe(room.state.epoch);
    await waitFor(() => room.state.matchPausedBy === '' && room.state.pausedAt === 0, 'resumed', 5_000);
  });

  it('sends a seat that never reaches the prepared boundary away, then forfeits it', async () => {
    const room = await newRoom(harness.testServer, {
      protocol: 2,
      mode: 'per-seat',
      maxPlayers: 2,
      startLeadMs: 500,
      timings: { seatReconnectSec: 0.3 },
    });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    reportPositions(room, owner, peer);
    const prepare = owner.waitForMessage('net.pause.prepare');
    owner.send('match.pause.request', {});
    owner.send('net.pause.ack', await prepare);
    await waitFor(() => !room.state.seats[1].connected, 'unacknowledged seat sent away', 2_000);
    await waitFor(() => room.state.seats[1].forfeited, 'unacknowledged seat forfeited', 2_000);
    owner.send('match.resume.request', {});
    await waitFor(() => room.state.matchResumeAt > 0, 'countdown without the forfeited seat');
  });

  it('starts the countdown once the forfeited pauser leaves every other seat connected', async () => {
    const room = await newRoom(harness.testServer, {
      protocol: 2,
      maxPlayers: 3,
      startLeadMs: 500,
      timings: { seatReconnectSec: 5 },
    });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const pauser = await connect(harness.testServer, room, 'p1', 'player');
    const third = await connect(harness.testServer, room, 'p2', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    pauser.send('match.pause.request', {});
    await waitFor(() => room.state.matchPausedBy === 'p1', 'paused by p1');
    await third.leave(false);
    await waitFor(() => !room.state.seats[2].connected, 'third offline');
    await pauser.leave(true);
    await waitFor(() => room.state.seats[1].forfeited, 'pauser forfeited', 2_000);
    expect(room.state.matchResumeAt).toBe(0);
    await connect(harness.testServer, room, 'p2', 'player');
    await waitFor(() => room.state.matchResumeAt > 0, 'countdown after the last seat returns');
  });

  it('sends the pending resume to a spectator joining during the countdown', async () => {
    const room = await newRoom(harness.testServer, {
      protocol: 2,
      mode: 'per-seat',
      maxPlayers: 2,
      spectators: 'on',
      startLeadMs: 500,
    });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    const target = owner.waitForMessage('net.pause.prepare');
    reportPositions(room, owner, peer);
    owner.send('match.pause.request', {});
    const boundary = await target;
    owner.send('net.pause.ack', boundary);
    peer.send('net.pause.ack', boundary);
    owner.send('match.resume.request', {});
    await waitFor(() => room.state.matchResumeAt > Date.now(), 'countdown');
    const originalTimeout = room.clock.setTimeout.bind(room.clock);
    const delayJoinMessages = vi
      .spyOn(room.clock, 'setTimeout')
      .mockImplementation((callback, delay, ...args) => originalTimeout(callback, delay === 0 ? 50 : delay, ...args));
    const viewer = await connect(harness.testServer, room, 'viewer', 'player');
    const resumes = vi.fn();
    viewer.onMessage('net.resume', resumes);
    await waitFor(() => resumes.mock.calls.length > 0, 'spectator resume');
    expect(resumes.mock.calls[0]?.[0].at).toBe(room.state.matchResumeAt);
    delayJoinMessages.mockRestore();
  });

  it('keeps a late per-seat client out until the rejoin window forfeits it', async () => {
    const room = await newRoom(harness.testServer, {
      protocol: 2,
      mode: 'per-seat',
      maxPlayers: 2,
      startLeadMs: 500,
      timings: { seatReconnectSec: 1 },
    });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    const prepare = peer.waitForMessage('net.pause.prepare');
    reportPositions(room, owner, peer);
    owner.send('match.pause.request', {});
    const target = await prepare;
    peer.send('net.pause.late', target);
    await waitFor(() => !room.state.seats[1].connected, 'late player offline');
    expect(room.state.seats[1].forfeited).toBe(false);
    expect(
      await rejectionCode(harness.testServer.sdk.joinById(room.roomId, await joinOptions(room, 'p1', 'player'))),
    ).toBe('SEAT_TAKEN');
    await waitFor(() => room.state.seats[1].forfeited, 'late player forfeited', 2_000);
  });

  it('cancels a prepared pause when the room leaves play mode', async () => {
    const room = await newRoom(harness.testServer, { protocol: 2, mode: 'per-seat', maxPlayers: 2, startLeadMs: 500 });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    const prepare = peer.waitForMessage('net.pause.prepare');
    reportPositions(room, owner, peer);
    owner.send('match.pause.request', {});
    await prepare;
    const cancelled = peer.waitForMessage('net.resume');
    owner.send('phase', { to: 'editing' });
    expect(await cancelled).toMatchObject({ epoch: room.state.epoch });
    await waitFor(() => room.state.phase === 'editing', 'editing');
    expect(room.state.matchPausedBy).toBe('');
    expect(room.state.pausedAt).toBe(0);
  });

  it('keeps an acknowledged per-seat pause while a player reconnects', async () => {
    const room = await newRoom(harness.testServer, {
      protocol: 2,
      mode: 'per-seat',
      maxPlayers: 2,
      startLeadMs: 500,
      timings: { seatReconnectSec: 3 },
    });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'p1', 'player');
    owner.send('net.start.request', { force: true });
    await waitFor(() => room.state.epoch !== '', 'epoch');
    await sleep(600);
    const prepareA = owner.waitForMessage('net.pause.prepare');
    const prepareB = peer.waitForMessage('net.pause.prepare');
    reportPositions(room, owner, peer);
    owner.send('match.pause.request', {});
    const [a, b] = await Promise.all([prepareA, prepareB]);
    owner.send('net.pause.ack', a);
    peer.send('net.pause.ack', b);
    await waitFor(() => Date.now() > room.state.pausedAt + 300, 'boundary passed');
    await peer.leave(false);
    await waitFor(() => !room.state.seats[1].connected, 'peer offline');
    const rejoined = await harness.testServer.sdk.joinById(room.roomId, await joinOptions(room, 'p1', 'player'));
    const starts = vi.fn();
    const prepares = vi.fn();
    rejoined.onMessage('net.start', starts);
    rejoined.onMessage('net.pause.prepare', prepares);
    await waitFor(() => prepares.mock.calls.length === 1, 'rejoin preparation');
    expect(room.state.matchPausedBy).toBe('owner');
    /* A reloaded SDK starts short of the boundary and runs up to it, rather than past it and out as late. */
    const startAt = starts.mock.calls[0]?.[0].startAt as number;
    expect(Math.floor(((Date.now() - startAt) * 60) / 1000)).toBeLessThan(b.tick);
    rejoined.send('net.pause.ack', b);
    owner.send('match.resume.request', {});
    await waitFor(() => room.state.matchResumeAt > 0, 'countdown after rejoin');
  });
});

function reportPositions(room: Awaited<ReturnType<typeof newRoom>>, ...clients: Awaited<ReturnType<typeof connect>>[]) {
  for (const client of clients) {
    client.onMessage('net.pause.probe', ({ epoch }: { epoch: string }) => {
      const tick = Math.max(0, Math.floor(((Date.now() - room.state.startAt) * 60) / 1000));
      client.send('net.pause.position', { epoch, tick });
    });
  }
}
