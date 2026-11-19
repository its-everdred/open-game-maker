import { loadEnv } from '@ogm/config';

import { roomTimings, type RoomTimings } from './lifecycle.js';

const SPEC = {
  OGM_ROOMS_PORT: { kind: 'port' },
  OGM_ROOMS_SEAT_RECONNECT_SEC: { kind: 'int', default: '30' },
  OGM_WS_TOKEN_SECRET: { kind: 'secret' },
  OGM_ROOMS_INTERNAL_SECRET: { kind: 'secret' },
  OGM_API_INTERNAL_URL: { kind: 'url' },
  OGM_GAMES_ORIGIN: { kind: 'url' },
} as const;

export type RoomsServiceConfig = {
  port: number;
  grantSecret: string;
  internalSecret: string;
  apiInternalUrl: string;
  gamesOrigin: string;
  version: string;
  timings: RoomTimings;
  endedFetch?: typeof fetch;
};

export function loadRoomsConfig(source?: Record<string, string | undefined>): RoomsServiceConfig {
  const values = source === undefined ? loadEnv('rooms', SPEC) : loadEnv('rooms', SPEC, source);
  if (Buffer.byteLength(values.OGM_WS_TOKEN_SECRET, 'utf8') < 32) {
    throw new Error('OGM_WS_TOKEN_SECRET must be at least 32 bytes');
  }
  if (Buffer.byteLength(values.OGM_ROOMS_INTERNAL_SECRET, 'utf8') < 32) {
    throw new Error('OGM_ROOMS_INTERNAL_SECRET must be at least 32 bytes');
  }
  if (values.OGM_ROOMS_SEAT_RECONNECT_SEC < 1 || values.OGM_ROOMS_SEAT_RECONNECT_SEC > 3600) {
    throw new Error('OGM_ROOMS_SEAT_RECONNECT_SEC must be between 1 and 3600');
  }

  return {
    port: values.OGM_ROOMS_PORT,
    grantSecret: values.OGM_WS_TOKEN_SECRET,
    internalSecret: values.OGM_ROOMS_INTERNAL_SECRET,
    apiInternalUrl: values.OGM_API_INTERNAL_URL,
    gamesOrigin: values.OGM_GAMES_ORIGIN,
    version: '0.0.0',
    timings: roomTimings({ seatReconnectSec: values.OGM_ROOMS_SEAT_RECONNECT_SEC }),
  };
}
