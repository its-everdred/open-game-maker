import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cwd, env as processEnvironment } from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadEnv } from '@ogm/config';

export const GAMES_HOST = '127.0.0.1' as const;
const DEFAULT_WORKER_SCRIPT = fileURLToPath(new URL('../../../packages/host/dist/game-cache.js', import.meta.url));

export interface GamesHostEnv {
  appOrigin: string;
  host: typeof GAMES_HOST;
  port: number;
  root: string;
  workerScript: string;
  apiInternalUrl?: string;
}

export function loadGamesHostEnv(environment: NodeJS.ProcessEnv = processEnvironment): GamesHostEnv {
  const { OGM_GAMES_SW: configuredWorkerScript, OGM_API_INTERNAL_URL: apiInternalUrl } = loadEnv(
    'games',
    { OGM_GAMES_SW: { kind: 'path', required: false }, OGM_API_INTERNAL_URL: { kind: 'string', required: false } },
    environment,
  );
  const host = environment.OGM_GAMES_BIND ?? GAMES_HOST;
  if (apiInternalUrl) {
    const parsed = new URL(apiInternalUrl);
    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    )
      throw new Error('OGM_API_INTERNAL_URL must be a loopback HTTP origin');
  }
  if (host !== GAMES_HOST) {
    throw new Error(`OGM_GAMES_BIND must be ${GAMES_HOST}`);
  }

  const portValue = required(environment, 'OGM_GAMES_PORT');
  if (!/^\d+$/u.test(portValue)) {
    throw new Error('OGM_GAMES_PORT must be an integer from 1 to 65535');
  }
  const port = Number(portValue);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('OGM_GAMES_PORT must be an integer from 1 to 65535');
  }

  return {
    appOrigin: validateOrigins(required(environment, 'OGM_APP_ORIGIN')),
    host: GAMES_HOST,
    port,
    root: resolve(required(environment, 'OGM_GAMES_ROOT')),
    workerScript: configuredWorkerScript ? resolve(configuredWorkerScript) : DEFAULT_WORKER_SCRIPT,
    ...(apiInternalUrl ? { apiInternalUrl } : {}),
  };
}

export function readGitVersion(repositoryDirectory: string = cwd()): string {
  try {
    const version = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
    return /^[0-9a-f]{40}$/u.test(version) ? version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function validateOrigins(value: string): string {
  const origins = value.split(/\s+/u);
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('OGM_APP_ORIGIN must contain HTTP(S) origins');
    }

    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin) {
      throw new Error('OGM_APP_ORIGIN must contain HTTP(S) origins');
    }
  }
  return origins.join(' ');
}
