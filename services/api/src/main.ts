import { join } from 'node:path';

import { serve } from '@hono/node-server';

import { FsBlobStore } from '@ogm/blob-store';
import { migrate, openDb } from '@ogm/db';

import { createApp } from './app/app.js';
import { API_HOST, loadApiEnv } from './app/env.js';
import { createAppEvents } from './app/events.js';
import { createRegistry } from './app/registry.js';
import { scanRoutes } from './app/routes-scan.js';
import type { AppDeps, LogLine } from './app/types.js';
import { readGitVersion } from './app/version.js';
import { startAnalyticsRetention } from './analytics/retention.js';

const log = (line: LogLine) => console.log(JSON.stringify({ service: 'api', ...line }));

const env = loadApiEnv();
const { sqlite, db } = openDb(join(env.OGM_DATA_DIR, 'ogm.sqlite3'));
log({ event: 'migrated', ...migrate({ sqlite }) });

const deps: AppDeps = {
  db,
  sqlite,
  config: {
    internalToken: env.OGM_INTERNAL_TOKEN,
    jobTokenSecret: env.OGM_JOB_TOKEN_SECRET,
    blobSigningKey: env.OGM_BLOB_SIGNING_KEY,
    appOrigin: env.OGM_APP_ORIGIN,
    publicOrigin: env.OGM_PUBLIC_ORIGIN,
    roomsInternalUrl: env.OGM_ROOMS_INTERNAL_URL,
    roomsInternalSecret: env.OGM_ROOMS_INTERNAL_SECRET,
    roomGrantSecret: env.OGM_WS_TOKEN_SECRET,
    commitInternalUrl: env.OGM_COMMIT_INTERNAL_URL,
    commitServiceToken: env.OGM_COMMIT_SERVICE_TOKEN,
    gameTemplateRef: env.OGM_GAME_TEMPLATE_REF,
    vapidKeyFile: env.OGM_VAPID_KEY_FILE,
    vapidSubject: `mailto:${env.OGM_VAPID_SUBJECT}`,
    analyticsRetentionDays: env.OGM_ANALYTICS_RETENTION_DAYS,
  },
  blobStore: new FsBlobStore({
    root: env.OGM_BLOB_ROOT,
    signingKey: env.OGM_BLOB_SIGNING_KEY,
    publicOrigin: env.OGM_PUBLIC_ORIGIN,
  }),
  events: createAppEvents(log),
  registry: createRegistry(),
  version: readGitVersion(),
  startedAtMs: Date.now(),
  log,
};

const stopAnalyticsRetention = startAnalyticsRetention({
  sqlite,
  retentionDays: deps.config.analyticsRetentionDays,
  log,
});

const app = createApp(deps);
for (const { prefix, file } of (await scanRoutes(app, { deps })).mounted) log({ event: 'mounted', prefix, file });

const server = serve({ fetch: app.fetch, hostname: API_HOST, port: env.OGM_API_PORT });
server.once('listening', () => log({ event: 'listening', host: API_HOST, port: env.OGM_API_PORT }));
process.once('SIGTERM', () => {
  stopAnalyticsRetention();
  server.close(() => sqlite.close());
});
