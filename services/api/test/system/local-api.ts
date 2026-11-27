import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { FsBlobStore } from '@ogm/blob-store';
import { migrate, openDb, schema } from '@ogm/db';

import { createAppEvents } from '../../src/app/events.js';
import { createRegistry, type DraftScopeAssistant, type RepoProvisioner } from '../../src/app/registry.js';
import type { AppDeps } from '../../src/app/types.js';
import { createChatJobDirectory } from '../../src/build-chat/job-directory.js';
import { BLOB_KEY, installUsers, INTERNAL_TOKEN, JOB_SECRET, makeApp } from '../helpers.js';

const user = {
  kind: 'user' as const,
  userId: 'u_system',
  familyId: 'f_system',
  platformRole: 'none' as const,
  capability: 'creator' as const,
  email: 'creator@example.test',
};

/** Start the real API with the existing test principal resolver and isolated disk state. */
export async function startLocalApi(
  root: string,
  options: { repoProvisioner?: RepoProvisioner; draftScopeAssistant?: DraftScopeAssistant } = {},
) {
  mkdirSync(root, { recursive: true });
  const { sqlite, db } = openDb(join(root, 'api.sqlite'));
  try {
    migrate({ sqlite });
    const log = () => {};
    const deps: AppDeps = {
      db,
      sqlite,
      config: {
        internalToken: INTERNAL_TOKEN,
        jobTokenSecret: JOB_SECRET,
        blobSigningKey: BLOB_KEY,
        appOrigin: 'http://127.0.0.1:43179',
        publicOrigin: 'http://127.0.0.1:43179',
        roomsInternalUrl: 'http://127.0.0.1:4302',
        roomsInternalSecret: 'rooms-internal-secret-for-tests',
        roomGrantSecret: 'room-grant-secret-for-tests-with-32-bytes',
        gamesOrigin: 'http://127.0.0.1:43179',
        commitInternalUrl: 'http://127.0.0.1:4301',
        commitServiceToken: 'commit-service-token-for-tests',
        gameTemplateRef: 'game-2d@1',
        instanceRepo: { owner: 'instance', name: 'games' },
        gamesRoot: join(root, 'games'),
        vapidKeyFile: join(root, 'vapid.json'),
        vapidSubject: 'mailto:operator@example.test',
        designDefaultMs: 300_000,
        analyticsRetentionDays: 90,
        defaultDailyAllowanceMicroUsd: 100_000_000,
        resetZoneDefault: 'America/Los_Angeles',
        reportBundleMaxBytes: 2 * 1024 * 1024,
        blobPutMaxBytes: 1024,
        narrationConcurrency: 2,
      },
      blobStore: new FsBlobStore({
        root: join(root, 'blobs'),
        signingKey: BLOB_KEY,
        publicOrigin: 'http://127.0.0.1:43179',
      }),
      events: createAppEvents(log),
      registry: createRegistry(),
      aiurClientForGame: async () => {
        throw new Error('system test tracker not configured');
      },
      version: 'system-test',
      startedAtMs: Date.now(),
      log,
    };
    db.insert(schema.families)
      .values({ id: user.familyId, name: 'System test', ownerUserId: user.userId, createdAt: new Date().toISOString() })
      .run();
    installUsers(deps, [user]);
    deps.registry.chatJobs = createChatJobDirectory(db);
    deps.registry.repoProvisioner = options.repoProvisioner ?? null;
    deps.registry.draftScopeAssistant = options.draftScopeAssistant ?? null;
    const { app } = await makeApp(deps);
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    return {
      origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      userId: user.userId,
      deps,
      async close() {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
