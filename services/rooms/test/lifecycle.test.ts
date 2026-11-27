import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  INTERNAL_SECRET,
  connect,
  defaultTimings,
  joinOptions,
  newRoom,
  rejectionCode,
  sleep,
  startHarness,
  waitFor,
  type Harness,
} from './helpers.js';

type Callback = { path: string; authorization?: string; body: { reason: string; endedAt: string } };

describe('GameRoom lifecycle', () => {
  let api: Server;
  let apiUrl: string;
  let harness: Harness;
  let callbacks: Callback[];
  let hangResponse: boolean;
  let responseStatus: number;

  beforeAll(async () => {
    callbacks = [];
    hangResponse = false;
    responseStatus = 204;
    api = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        callbacks.push({
          path: request.url ?? '',
          authorization: request.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Callback['body'],
        });
        if (hangResponse) return;
        response.writeHead(responseStatus);
        response.end();
      });
    });
    api.listen(0, '127.0.0.1');
    await once(api, 'listening');
    const address = api.address();
    if (address === null || typeof address === 'string') throw new Error('callback server did not bind');
    apiUrl = `http://127.0.0.1:${address.port}`;
    harness = await startHarness({ apiInternalUrl: apiUrl, endedFetch: fetch });
  });

  afterEach(async () => {
    hangResponse = false;
    responseStatus = 204;
    await harness.testServer.cleanup();
    callbacks.length = 0;
  });

  afterAll(async () => {
    await harness.testServer.shutdown();
    api.close();
    await once(api, 'close');
  });

  it('pauses for an editor drop, restores phase on reconnect, and sends resync', async () => {
    const room = await newRoom(harness.testServer, { timings: { ownerReconnectSec: 30 } });
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    owner.send('design.tx', {
      tx: {
        branchId: 'main',
        rev: 4,
        baseRev: 0,
        actor: 'owner',
        kind: 'manual',
        patches: [{ op: 'replace', path: '/globals/x', value: 1 }],
      },
    });
    await room.waitForNextMessage(20);
    owner.send('phase', { to: 'playing' });
    await room.waitForNextMessage(20);
    const token = owner.reconnectionToken;
    owner.reconnection.enabled = false;
    await owner.leave(false);
    await waitFor(() => room.state.phase === 'pausedForHost', 'owner paused', 5_000);

    const reconnected = await harness.testServer.sdk.reconnect(token);
    const resync = await reconnected.waitForMessage('resync');
    expect(resync).toEqual({ fromRev: 5 });
    expect(room.state.phase).toBe('playing');
  });

  it('ends and records host-left when the owner misses the reconnection window', async () => {
    const room = await newRoom(harness.testServer);
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'peer', 'player');
    const ended = peer.waitForMessage('ended');
    owner.reconnection.enabled = false;
    await owner.leave(false);

    expect(await ended).toEqual({ reason: 'host-left' });
    await sleep(40);
    expect(callbacks).toContainEqual({
      path: `/internal/rooms/${room.roomId}/ended`,
      authorization: `Bearer ${INTERNAL_SECRET}`,
      body: { reason: 'host-left', endedAt: expect.any(String) as string },
    });
  });

  it('frees a timed-out player index for the next member', async () => {
    const room = await newRoom(harness.testServer);
    await connect(harness.testServer, room, 'owner', 'owner');
    const player = await connect(harness.testServer, room, 'player', 'player');
    player.reconnection.enabled = false;
    await player.leave(false);
    await sleep(defaultTimings.playerReconnectSec * 1_000 + 40);

    const replacement = await harness.testServer.sdk.joinById(
      room.roomId,
      await joinOptions(room, 'replacement', 'player'),
    );
    const welcome = await replacement.waitForMessage('welcome');
    expect(welcome.you.playerIndex).toBe(1);
  });

  it('makes the newest owner session editor and drops old-session owner messages', async () => {
    const room = await newRoom(harness.testServer);
    const first = await connect(harness.testServer, room, 'owner', 'owner');
    const second = await connect(harness.testServer, room, 'owner', 'owner');
    expect(room.state.editorSessionId).toBe(second.sessionId);
    expect(room.state.members.get('owner')?.sessions).toHaveLength(2);

    first.send('design.tx', {
      tx: {
        branchId: 'main',
        rev: 1,
        baseRev: 0,
        actor: 'owner',
        kind: 'manual',
        patches: [{ op: 'replace', path: '/globals/x', value: 1 }],
      },
    });
    await room.waitForNextMessage(20);
    expect(room.state.lastRev).toBe(0);
    expect(room.droppedCounts['design.tx']).toBe(1);

    await second.leave();
    await sleep(20);
    expect(room.state.editorSessionId).toBe(first.sessionId);

    first.send('design.tx', {
      tx: {
        branchId: 'main',
        rev: 2,
        baseRev: 0,
        actor: 'owner',
        kind: 'manual',
        patches: [{ op: 'replace', path: '/globals/x', value: 2 }],
      },
    });
    await room.waitForNextMessage(20);
    expect(room.state.lastRev).toBe(2);
  });

  it('revokes connected sessions and rejects a fresh join for the revoked user', async () => {
    const room = await newRoom(harness.testServer);
    await connect(harness.testServer, room, 'owner', 'owner');
    const player = await connect(harness.testServer, room, 'player', 'player');
    const ended = player.waitForMessage('ended');
    room.revoke({ userId: 'player' });

    expect(await ended).toEqual({ reason: 'revoked' });
    await sleep(40);
    expect(await rejectionCode(connect(harness.testServer, room, 'player', 'player'))).toBe('GRANT_REVOKED');
  });

  it('rejects a revoked session that tries to reconnect from a held seat', async () => {
    const room = await newRoom(harness.testServer, { timings: { playerReconnectSec: 30 } });
    const player = await connect(harness.testServer, room, 'player', 'player');
    const token = player.reconnectionToken;
    player.reconnection.enabled = false;
    await player.leave(false);
    await sleep(30);

    room.revoke({ userId: 'player' });

    await expect(harness.testServer.sdk.reconnect(token)).rejects.toThrow();
    await sleep(30);
    expect(room.state.members.has('player')).toBe(false);
  });

  it('keeps a held owner session alive when the other owner device closes', async () => {
    const room = await newRoom(harness.testServer, { timings: { ownerReconnectSec: 30 } });
    const first = await connect(harness.testServer, room, 'owner', 'owner');
    const second = await connect(harness.testServer, room, 'owner', 'owner');
    const token = second.reconnectionToken;
    second.reconnection.enabled = false;
    await second.leave(false);
    await sleep(30);

    await first.leave();
    expect(room.state.phase).toBe('pausedForHost');
    expect(harness.testServer.getRoomById(room.roomId)).toBeDefined();

    const reconnected = await harness.testServer.sdk.reconnect(token);
    await reconnected.waitForMessage('resync');
    expect(room.state.phase).toBe('editing');
    expect(room.state.editorSessionId).toBe(reconnected.sessionId);
  });

  it('records owner-closed on a consented final owner leave', async () => {
    const room = await newRoom(harness.testServer);
    const owner = await connect(harness.testServer, room, 'owner', 'owner');
    const peer = await connect(harness.testServer, room, 'peer', 'player');
    const ended = peer.waitForMessage('ended');
    await owner.leave();

    expect(await ended).toEqual({ reason: 'owner-closed' });
    await sleep(40);
    expect(callbacks.at(-1)?.body.reason).toBe('owner-closed');
  });

  it('disposes an unjoined idle room and records idle', async () => {
    const room = await newRoom(harness.testServer, {
      timings: { ...defaultTimings, idleDisposeSec: 0.08 },
    });

    await waitFor(() => harness.testServer.getRoomById(room.roomId) === undefined, 'idle room disposal', 5_000);
    expect(harness.testServer.getRoomById(room.roomId)).toBeUndefined();
    expect(callbacks.at(-1)?.body.reason).toBe('idle');
  });

  it('retries a failing ended callback, logs once, and still disposes', async () => {
    responseStatus = 500;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const room = await newRoom(harness.testServer, {
      timings: { ...defaultTimings, idleDisposeSec: 0.05, callbackRetryMs: [5, 10, 20] },
    });

    await waitFor(
      () => harness.testServer.getRoomById(room.roomId) === undefined,
      'room disposal after callback retries',
      5_000,
    );
    expect(harness.testServer.getRoomById(room.roomId)).toBeUndefined();
    expect(callbacks).toHaveLength(4);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('times out a hung ended callback, logs once, and still disposes', async () => {
    hangResponse = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const room = await newRoom(harness.testServer, {
      timings: {
        ...defaultTimings,
        idleDisposeSec: 0.05,
        callbackTimeoutMs: 25,
        callbackRetryMs: [5, 10],
      },
    });

    await waitFor(
      () => harness.testServer.getRoomById(room.roomId) === undefined,
      'room disposal after callback timeouts',
      5_000,
    );
    expect(harness.testServer.getRoomById(room.roomId)).toBeUndefined();
    expect(callbacks).toHaveLength(3);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
