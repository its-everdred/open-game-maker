import { describe, expect, it } from 'vitest';

import { loadRoomsConfig } from '../src/config.js';

const base = {
  OGM_ROOMS_PORT: '4302',
  OGM_WS_TOKEN_SECRET: 'test-grant-secret-at-least-thirty-two-bytes',
  OGM_ROOMS_INTERNAL_SECRET: 'test-internal-secret-at-least-thirty-two-bytes',
  OGM_API_INTERNAL_URL: 'http://127.0.0.1:4300',
  OGM_GAMES_ORIGIN: 'http://127.0.0.1:10000',
};

describe('rooms configuration', () => {
  it('defaults the seat rejoin window to 30 seconds and accepts an override', () => {
    expect(loadRoomsConfig(base).timings.seatReconnectSec).toBe(30);
    expect(loadRoomsConfig({ ...base, OGM_ROOMS_SEAT_RECONNECT_SEC: '60' }).timings.seatReconnectSec).toBe(60);
  });

  it('rejects reconnect windows outside the supported range', () => {
    expect(() => loadRoomsConfig({ ...base, OGM_ROOMS_SEAT_RECONNECT_SEC: '0' })).toThrow(
      'OGM_ROOMS_SEAT_RECONNECT_SEC',
    );
    expect(() => loadRoomsConfig({ ...base, OGM_ROOMS_SEAT_RECONNECT_SEC: '3601' })).toThrow(
      'OGM_ROOMS_SEAT_RECONNECT_SEC',
    );
  });
});
