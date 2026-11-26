// @vitest-environment node

import { createServer } from 'node:net';

import { ColyseusTestServer } from '@colyseus/testing';
import type { DesignDoc, Patch } from '@ogm/design-log';
import { apply } from '@ogm/design-log';
import {
  PROTOCOL_VERSION,
  type DesignTx,
  type GameManifest,
  type MultiplayerHooksV2,
  type RoomPin,
} from '@ogm/contracts';
import { createNetController } from '@gm/sdk/net';
import { signGrant } from '@ogm/room-protocol';
import { createRoomsServer } from '@ogm/rooms';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoomClient } from './room-client';
import { attachBridgeForwarding } from './bridge-forwarding';
import { createRoomStore } from './room-store';
import { WatcherSync } from './watcher-sync';

const grantSecret = 'rooms-integration-grant-secret-32-bytes';
const pin: RoomPin = { gameId: 'game-integration', branchId: 'main', buildId: 'build-1' };
const initialDoc: DesignDoc = { schemaVersion: 1, globals: { gravity: 1 }, entities: {} };
let testServer: ColyseusTestServer | undefined;

afterEach(async () => {
  await testServer?.shutdown();
  testServer = undefined;
});

describe('RoomClient with GameRoom', () => {
  it('starts an epoch after two SDK seats mark themselves ready', async () => {
    const port = await availablePort();
    const bundle = createRoomsServer({
      port,
      grantSecret,
      internalSecret: 'rooms-integration-internal-secret-32-bytes',
      apiInternalUrl: 'http://127.0.0.1:1',
      gamesOrigin: 'https://games.example.test',
      version: 'test',
      timings: {
        ownerReconnectSec: 0.2,
        playerReconnectSec: 0.2,
        seatReconnectSec: 0.2,
        idleDisposeSec: 1,
        callbackTimeoutMs: 50,
        callbackRetryMs: [1, 2, 3],
      },
      endedFetch: async () => new Response(null, { status: 204 }),
    });
    await bundle.gameServer.listen(port, '127.0.0.1');
    testServer = new ColyseusTestServer(bundle.gameServer);
    const room = await testServer.createRoom('game', { ...pin, ownerId: 'owner-1', maxPlayers: 2, protocol: 2 });
    const stores = [createRoomStore(), createRoomStore()];
    const clients = stores.map(
      (store) =>
        new RoomClient({
          roomsUrl: `ws://127.0.0.1:${port}`,
          store,
          clientFactory: () => testServer!.sdk,
        }),
    );
    const starts: unknown[][] = [[], []];
    const forwards = clients.map((client, index) =>
      attachBridgeForwarding({
        bridge: {
          send: (envelope) => {
            if (envelope.t === 'net.start') starts[index]!.push(envelope.payload);
          },
        },
        client,
        store: stores[index]!,
      }),
    );
    const hooks = {
      spawn() {},
      despawn() {},
      snapshot: () => ({ tick: 0, state: {} }),
      applySnapshot() {},
      hud: () => ({}),
      capture: () => ({ tick: 0, state: {} }),
      restore() {},
      digest: () => [],
    } satisfies MultiplayerHooksV2;
    const controllers = forwards.map((forward, index) =>
      createNetController({
        manifest: { inputs: { actions: {} }, net: { authority: 'per-seat', maxSeats: 2 } } as GameManifest,
        hooks,
        localPlayerIndex: index,
        send: (t, payload) => forward.handleGameMessage({ v: 1, id: `sdk-${t}`, t, payload }),
        acceptInput() {},
        syncPlayers() {},
        setLocalPlayerIndex() {},
        recordEvent() {},
        now: () => 0,
      }),
    );
    try {
      for (const [index, client] of clients.entries()) {
        await client.join({
          roomId: room.roomId,
          grant: await grant(room.roomId, index === 0 ? 'owner-1' : 'player-1', index === 0 ? 'owner' : 'player'),
          pin,
          expiresAt: Date.now() + 600_000,
        });
        await waitForStores([stores[index]!], () => stores[index]!.getState().status === 'connected');
      }
      await waitForStores(stores, () => stores.every((store) => store.getState().status === 'connected'));
      controllers.forEach((controller) => controller.net.setReady(true));
      await vi.waitFor(
        () =>
          expect(
            room.state.seats.filter((seat: { userId: string; ready: boolean }) => seat.userId && seat.ready),
          ).toHaveLength(2),
        {
          timeout: 10_000,
        },
      );
      controllers[0]!.net.requestStart();
      await vi.waitFor(() => expect(room.state.epoch, JSON.stringify(room.seatDrops)).not.toBe(''), {
        timeout: 10_000,
      });
      await vi.waitFor(() => expect(starts.map((messages) => messages.length)).toEqual([1, 1]), { timeout: 10_000 });
      expect(starts[0]![0]).toMatchObject({ epoch: expect.any(String), seats: expect.any(Array) });
      expect((starts[0]![0] as { epoch: string }).epoch).toBe((starts[1]![0] as { epoch: string }).epoch);
    } finally {
      controllers.forEach((controller) => controller.dispose());
      forwards.forEach((forward) => forward.detach());
      await Promise.all(clients.map((client) => client.leave()));
    }
  }, 25_000);

  it('keeps a watcher document equal to the host document at every relayed revision', async () => {
    const port = await availablePort();
    const bundle = createRoomsServer({
      port,
      grantSecret,
      internalSecret: 'rooms-integration-internal-secret-32-bytes',
      apiInternalUrl: 'http://127.0.0.1:1',
      gamesOrigin: 'https://games.example.test',
      version: 'test',
      timings: {
        ownerReconnectSec: 0.2,
        playerReconnectSec: 0.2,
        seatReconnectSec: 0.2,
        idleDisposeSec: 1,
        callbackTimeoutMs: 50,
        callbackRetryMs: [1, 2, 3],
      },
      endedFetch: async () => new Response(null, { status: 204 }),
    });
    await bundle.gameServer.listen(port, '127.0.0.1');
    testServer = new ColyseusTestServer(bundle.gameServer);
    const room = await testServer.createRoom('game', {
      ...pin,
      ownerId: 'owner-1',
      maxPlayers: 4,
      /* The web client joins with the newest protocol, so the room it edits must speak it too. */
      protocol: PROTOCOL_VERSION,
    });
    const ownerGrant = await grant(room.roomId, 'owner-1', 'owner');
    const watcherGrant = await grant(room.roomId, 'watcher-1', 'player');

    const ownerStore = createRoomStore();
    const watcherStore = createRoomStore();
    const owner = new RoomClient({
      roomsUrl: `ws://127.0.0.1:${port}`,
      store: ownerStore,
      clientFactory: () => testServer!.sdk,
    });
    const watcher = new RoomClient({
      roomsUrl: `ws://127.0.0.1:${port}`,
      store: watcherStore,
      clientFactory: () => testServer!.sdk,
    });
    const appliedRevisions = new Set<number>();
    const applyListeners = new Set<() => void>();
    const subscribeToApply = (listener: () => void) => {
      applyListeners.add(listener);
      return () => applyListeners.delete(listener);
    };
    const sync = new WatcherSync({
      bridge: {
        send: (envelope) => {
          if (envelope.t !== 'design.apply') return;
          appliedRevisions.add((envelope.payload as { rev: number }).rev);
          applyListeners.forEach((listener) => listener());
        },
      },
      fetchSnapshot: async () => ({ rev: 0, doc: initialDoc }),
      store: watcherStore,
    });
    watcher.subscribe((message) => {
      if (message.t === 'welcome') void sync.onWelcome(message.state);
      if (message.t === 'design.tx') sync.onTransaction(message.tx);
      if (message.t === 'resync') void sync.onResync(message.fromRev);
    });

    await Promise.all([
      owner.join({ roomId: room.roomId, grant: ownerGrant, pin, expiresAt: Date.now() + 600_000 }),
      watcher.join({ roomId: room.roomId, grant: watcherGrant, pin, expiresAt: Date.now() + 600_000 }),
    ]);
    /* A protocol-2 join sends the seat table beside the welcome, and the real room/socket setup runs beside
     * eighteen jsdom files; the existing 25 s test budget covers setup and all sync revisions under load. */
    await waitForStores(
      [ownerStore, watcherStore],
      () => ownerStore.getState().status === 'connected' && watcherStore.getState().status === 'connected',
    );
    await waitForSignal(subscribeToApply, () => appliedRevisions.has(0));

    let hostDoc = initialDoc;
    for (let rev = 1; rev <= 3; rev += 1) {
      const patches: Patch[] = [{ op: 'replace', path: ['globals', 'gravity'], value: rev + 1 }];
      hostDoc = apply(hostDoc, patches);
      ownerStore.getState().publishTransaction(transaction(rev, patches));
      await waitForSignal(subscribeToApply, () => appliedRevisions.has(rev));
      expect(sync.appliedRev).toBe(rev);
      expect(sync.doc).toEqual(hostDoc);
    }

    await Promise.all([watcher.leave(), owner.leave()]);
  }, 25_000);
});

async function grant(roomId: string, userId: string, role: 'owner' | 'player'): Promise<string> {
  return signGrant({ sub: userId, roomId, gameId: pin.gameId, role, name: userId }, grantSecret);
}

function transaction(rev: number, patches: Patch[]): DesignTx {
  return {
    branchId: pin.branchId,
    rev,
    baseRev: rev - 1,
    actor: 'owner-1',
    kind: 'manual',
    patches,
  };
}

async function waitForSignal(subscribe: (listener: () => void) => () => void, condition: () => boolean): Promise<void> {
  if (condition()) return;

  await new Promise<void>((resolve) => {
    let unsubscribe: () => void = () => {};
    const check = () => {
      if (!condition()) return;
      unsubscribe();
      resolve();
    };
    unsubscribe = subscribe(check);
    check();
  });
}

async function waitForStores(
  stores: Array<ReturnType<typeof createRoomStore>>,
  condition: () => boolean,
): Promise<void> {
  await waitForSignal((listener) => {
    const unsubscribers = stores.map((store) => store.subscribe(listener));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, condition);
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test server did not bind a TCP port');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}
