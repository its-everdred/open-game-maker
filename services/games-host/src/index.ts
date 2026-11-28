import { serve, type ServerType } from '@hono/node-server';
import { resolve } from 'node:path';
import process, { argv, env } from 'node:process';
import { pathToFileURL } from 'node:url';

import { loadGamesHostEnv, readGitVersion } from './env.js';
import { createApp } from './server.js';

export function main(environment: NodeJS.ProcessEnv = env): ServerType {
  const config = loadGamesHostEnv(environment);
  const check = async (request: object): Promise<{ allowed?: boolean; previewAccessId?: string }> => {
    if (!config.apiInternalUrl) return {};
    const response = await fetch(new URL('/api/v1/artifacts/authorize', config.apiInternalUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return {};
    const result: unknown = await response.json();
    return typeof result === 'object' && result !== null ? result : {};
  };
  const app = createApp({
    appOrigin: config.appOrigin,
    root: config.root,
    version: readGitVersion(),
    workerScript: config.workerScript,
    authorize: async (request) => {
      return (await check(request)).allowed === true;
    },
    resolvePreview: async (gameId, preview) => {
      const result = await check({ gameId, preview });
      return result.allowed === true && typeof result.previewAccessId === 'string' ? result.previewAccessId : null;
    },
  });
  const server = serve({
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  });

  const shutdown = () => {
    server.close((error) => {
      if (error) {
        process.exitCode = 1;
      }
    });
  };
  server.once('listening', () => {
    console.log(JSON.stringify({ event: 'listening', service: 'games-host' }));
    process.once('SIGTERM', shutdown);
  });
  server.once('error', () => {
    process.exitCode = 1;
    console.error(JSON.stringify({ event: 'server-error', service: 'games-host' }));
  });
  server.once('close', () => {
    process.removeListener('SIGTERM', shutdown);
  });

  return server;
}

const entryPath = argv[1];
if (entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url) {
  main();
}
