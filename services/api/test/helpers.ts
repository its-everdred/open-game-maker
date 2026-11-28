import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FsBlobStore } from '@ogm/blob-store';
import type { Principal } from '@ogm/contracts';
import { migrate, openDb, schema } from '@ogm/db';
import { eq } from 'drizzle-orm';

import { createApp } from '../src/app/app.js';
import { createAppEvents } from '../src/app/events.js';
import { createRegistry } from '../src/app/registry.js';
import { scanRoutes } from '../src/app/routes-scan.js';
import type { AppDeps, LogLine } from '../src/app/types.js';

export const INTERNAL_TOKEN = 'internal-token-for-tests-0123456789';
export const JOB_SECRET = 'job-token-secret-for-tests-0123456789';
export const BLOB_KEY = 'blob-signing-key-for-tests-with-32-bytes';
export type TestUser = Extract<Principal, { kind: 'user' }> & { email: string };

export function installUsers(deps: AppDeps, users: readonly TestUser[]): void {
  const byId = new Map(users.map((user) => [user.userId, user]));
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user.userId]));
  deps.registry.principalResolvers.push(async (c) => {
    const userId = c.req.header('x-test-user');
    const user = userId ? byId.get(userId) : undefined;
    if (!user) return null;
    const principal: Extract<Principal, { kind: 'user' }> = {
      kind: 'user',
      userId: user.userId,
      displayName: user.displayName,
      familyId: user.familyId,
      platformRole: user.platformRole,
      capability: user.capability,
    };
    const membership = deps.db
      .select({ familyId: schema.familyMembers.familyId, capability: schema.familyMembers.capability })
      .from(schema.familyMembers)
      .where(eq(schema.familyMembers.userId, user.userId))
      .get();
    return membership ? { ...principal, ...membership } : principal;
  });
  deps.registry.userDirectory = {
    emailForUser: async (userId) => byId.get(userId)?.email ?? null,
    userIdForEmail: async (email) => byEmail.get(email.toLowerCase()) ?? null,
  };
}

export const asUser = (userId: string): Record<string, string> => ({ 'x-test-user': userId });

export function makeDeps(): AppDeps & { lines: LogLine[] } {
  const { sqlite, db } = openDb(':memory:');
  migrate({ sqlite });
  const lines: LogLine[] = [];
  const privateDirectory = mkdtempSync(join(tmpdir(), 'ogm-api-private-'));
  const log = (line: LogLine) => {
    lines.push(line);
  };
  return {
    db,
    sqlite,
    config: {
      internalToken: INTERNAL_TOKEN,
      jobTokenSecret: JOB_SECRET,
      blobSigningKey: BLOB_KEY,
      appOrigin: 'https://app.example.test',
      publicOrigin: 'https://api.example.test:8443',
      roomsInternalUrl: 'http://127.0.0.1:4302',
      roomsInternalSecret: 'rooms-internal-secret-for-tests',
      roomGrantSecret: 'room-grant-secret-for-tests-with-32-bytes',
      gamesOrigin: 'https://games.example.test',
      commitInternalUrl: 'http://127.0.0.1:4301',
      commitServiceToken: 'commit-service-token-for-tests',
      gameTemplateRef: 'game-2d@1',
      instanceRepo: { owner: 'instance', name: 'games' },
      gamesRoot: mkdtempSync(join(tmpdir(), 'ogm-api-games-')),
      vapidKeyFile: join(privateDirectory, 'ogm-api.vapid.json'),
      vapidSubject: 'mailto:operator@example.test',
      designDefaultMs: 300_000,
      analyticsRetentionDays: 90,
      defaultDailyAllowanceMicroUsd: 5_000_000,
      creatorJobLimit: 1,
      resetZoneDefault: 'America/Los_Angeles',
      reportBundleMaxBytes: 2 * 1024 * 1024,
      blobPutMaxBytes: 1024,
      narrationConcurrency: 2,
    },
    blobStore: new FsBlobStore({
      root: mkdtempSync(join(tmpdir(), 'ogm-api-blobs-')),
      signingKey: BLOB_KEY,
      publicOrigin: 'https://api.example.test:8443',
    }),
    events: createAppEvents(log),
    registry: createRegistry(),
    aiurClientForGame: async () => {
      throw new Error('test aiur client not configured');
    },
    version: 'test-version',
    startedAtMs: Date.now() - 5_000,
    log,
    lines,
  };
}

// The production app: middleware plus every context under src/.
export async function makeApp(deps = makeDeps()) {
  const app = createApp(deps);
  const { mounted } = await scanRoutes(app, { deps });
  return { app, deps, mounted };
}
