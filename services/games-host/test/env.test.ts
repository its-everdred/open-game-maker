import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadGamesHostEnv } from '../src/env.js';

const validEnvironment = {
  OGM_GAMES_PORT: '3400',
  OGM_GAMES_ROOT: './games',
  OGM_APP_ORIGIN: 'https://makeopen.games',
};
const defaultWorkerScript = fileURLToPath(new URL('../../../packages/host/dist/game-cache.js', import.meta.url));

describe('games-host environment', () => {
  it('loads the loopback-only service configuration', () => {
    expect(loadGamesHostEnv(validEnvironment)).toEqual({
      appOrigin: 'https://makeopen.games',
      host: '127.0.0.1',
      port: 3400,
      root: resolve('./games'),
      workerScript: defaultWorkerScript,
    });
  });

  it('resolves an explicit cache worker path', () => {
    expect(loadGamesHostEnv({ ...validEnvironment, OGM_GAMES_SW: './worker.js' }).workerScript).toBe(
      resolve('./worker.js'),
    );
  });

  it('accepts only a loopback API origin for artifact authorization', () => {
    expect(
      loadGamesHostEnv({ ...validEnvironment, OGM_API_INTERNAL_URL: 'http://127.0.0.1:4300' }).apiInternalUrl,
    ).toBe('http://127.0.0.1:4300');
    expect(() => loadGamesHostEnv({ ...validEnvironment, OGM_API_INTERNAL_URL: 'https://example.test' })).toThrow(
      'OGM_API_INTERNAL_URL must be a loopback HTTP origin',
    );
  });

  it('accepts multiple explicit frame ancestors', () => {
    expect(
      loadGamesHostEnv({
        ...validEnvironment,
        OGM_APP_ORIGIN: 'https://makeopen.games http://127.0.0.1:5173',
      }).appOrigin,
    ).toBe('https://makeopen.games http://127.0.0.1:5173');
  });

  it.each(['0', '65536', '3.5', 'port'])('rejects invalid port %s', (port) => {
    expect(() => loadGamesHostEnv({ ...validEnvironment, OGM_GAMES_PORT: port })).toThrow(
      'OGM_GAMES_PORT must be an integer from 1 to 65535',
    );
  });

  it.each(['ftp://example.test', 'https://example.test/path', 'https://example.test; script-src *'])(
    'rejects invalid app origin %s',
    (appOrigin) => {
      expect(() => loadGamesHostEnv({ ...validEnvironment, OGM_APP_ORIGIN: appOrigin })).toThrow(
        'OGM_APP_ORIGIN must contain HTTP(S) origins',
      );
    },
  );
});
