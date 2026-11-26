import { serve, type ServerType } from '@hono/node-server';
import { resolve } from 'node:path';
import process, { argv, env } from 'node:process';
import { pathToFileURL } from 'node:url';

import { loadGamesHostEnv, readGitVersion } from './env.js';
import { createApp } from './server.js';

export function main(environment: NodeJS.ProcessEnv = env): ServerType {
  const config = loadGamesHostEnv(environment);
  const app = createApp({
    accessApi: config.accessApi,
    appOrigin: config.appOrigin,
    root: config.root,
    version: readGitVersion(),
    workerScript: config.workerScript,
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
