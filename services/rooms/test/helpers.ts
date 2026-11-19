import type { Room as ClientRoom } from '@colyseus/sdk';
import { ColyseusTestServer } from '@colyseus/testing';
import { LIMITS, type Role } from '@ogm/contracts';
import { signGrant } from '@ogm/room-protocol';

import { createRoomsServer, type RoomsServerBundle, type RoomsServiceConfig } from '../src/server.js';
import { GameRoom, type GameRoomOptions, type RoomTimings } from '../src/game-room.js';

export const GRANT_SECRET = 'rooms-test-grant-secret-is-at-least-32-bytes';
export const OTHER_GRANT_SECRET = 'rooms-other-grant-secret-is-also-32-bytes';
export const INTERNAL_SECRET = 'rooms-test-internal-secret-is-32-bytes';
export const GAMES_ORIGIN = 'https://games.example.test';

export const defaultTimings: RoomTimings = {
  ownerReconnectSec: 0.2,
  playerReconnectSec: 0.2,
  seatReconnectSec: 0.2,
  // Connection setup can take longer under a concurrent workspace test run.
  idleDisposeSec: 30,
  callbackTimeoutMs: 100,
  callbackRetryMs: [5, 10, 20],
};

export type Harness = RoomsServerBundle & { testServer: ColyseusTestServer };

export async function startHarness(overrides: Partial<RoomsServiceConfig> = {}, port = 0): Promise<Harness> {
  const bundle = createRoomsServer({
    port: 2568,
    grantSecret: GRANT_SECRET,
    internalSecret: INTERNAL_SECRET,
    apiInternalUrl: 'http://127.0.0.1:1',
    gamesOrigin: GAMES_ORIGIN,
    version: 'test-version',
    timings: defaultTimings,
    endedFetch: async () => new Response(null, { status: 204 }),
    ...overrides,
  });
  await bundle.gameServer.listen(port, '127.0.0.1');
  const address = bundle.gameServer.transport.server?.address();
  if (address === null || address === undefined || typeof address === 'string')
    throw new Error('test server did not bind');
  // ColyseusTestServer reads the requested port, which is zero for an ephemeral bind.
  Object.assign(bundle.gameServer, { port: address.port });
  const testServer = new ColyseusTestServer(bundle.gameServer);
  return { ...bundle, testServer };
}

export async function newRoom(
  testServer: ColyseusTestServer,
  overrides: Partial<GameRoomOptions> = {},
): Promise<GameRoom> {
  return testServer.createRoom<GameRoom>('game', {
    gameId: 'g_test',
    branchId: 'main',
    buildId: 'sha256:one',
    ownerId: 'owner',
    maxPlayers: LIMITS.maxPlayersDefault,
    ...overrides,
  });
}

export async function joinOptions(
  room: GameRoom,
  userId: string,
  role: Role,
  overrides: { buildId?: string; protocol?: number; secret?: string; nowMs?: number; ttlSec?: number } = {},
) {
  const nowMs = overrides.nowMs ?? Date.now();
  return {
    grant: await signGrant(
      {
        sub: userId,
        roomId: room.roomId,
        gameId: room.state.pin.gameId,
        role,
        name: userId,
        ...(overrides.ttlSec === undefined ? {} : { ttlSec: overrides.ttlSec }),
      },
      overrides.secret ?? GRANT_SECRET,
      nowMs,
    ),
    buildId: overrides.buildId ?? room.state.pin.buildId,
    /* The helper speaks the protocol of the room it is given, so every v1 test keeps asserting v1. */
    protocol: overrides.protocol ?? room.state.protocol,
  };
}

export async function connect(
  testServer: ColyseusTestServer,
  room: GameRoom,
  userId: string,
  role: Role,
): Promise<ClientRoom> {
  return testServer.connectTo(room, await joinOptions(room, userId, role));
}

export async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error('join unexpectedly succeeded');
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    try {
      return (JSON.parse(error.message) as { code: string }).code;
    } catch {
      throw new Error(`join did not return a JoinRejection: ${error.message}`);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(condition: () => boolean, description: string, timeoutMs = 1_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await sleep(10);
  }
}
