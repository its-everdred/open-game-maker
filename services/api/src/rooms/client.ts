import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';

type CreateRelayRoom = {
  gameId: string;
  branchId: string;
  buildId: string;
  ownerId: string;
  maxPlayers: number;
};

type RevokeRelayRoom = { jti?: string; userId?: string };

async function request(
  deps: AppDeps,
  path: string,
  body: CreateRelayRoom | RevokeRelayRoom,
  fetchImpl: typeof fetch,
): Promise<Response> {
  try {
    return await fetchImpl(`${deps.config.roomsInternalUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.config.roomsInternalSecret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(503, 'rooms_unavailable');
  }
}

export async function createRelayRoom(
  deps: AppDeps,
  body: CreateRelayRoom,
  fetchImpl: typeof fetch,
): Promise<{ roomId: string }> {
  const response = await request(deps, '/internal/rooms', body, fetchImpl);
  if (!response.ok) throw new HttpError(503, 'rooms_unavailable');
  const result = (await response.json().catch(() => null)) as { roomId?: unknown } | null;
  if (typeof result?.roomId !== 'string' || result.roomId.length === 0) {
    throw new HttpError(502, 'rooms_invalid_response');
  }
  return { roomId: result.roomId };
}

export async function revokeRelayRoom(
  deps: AppDeps,
  roomId: string,
  body: RevokeRelayRoom,
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await request(deps, `/internal/rooms/${encodeURIComponent(roomId)}/revoke`, body, fetchImpl);
  if (response.status === 404) throw new HttpError(404, 'room_not_found');
  if (!response.ok) throw new HttpError(503, 'rooms_unavailable');
}
