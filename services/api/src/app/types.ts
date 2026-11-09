import type { BlobStore } from '@ogm/blob-store';
import type { AiurClient } from '@ogm/aiur-client';
import type { Principal } from '@ogm/contracts';
import type { Db, Sqlite } from '@ogm/db';

import type { AppEvents } from './events.js';
import type { Registry } from './registry.js';

export type LogLine = Record<string, unknown>;

export interface AppDeps {
  db: Db;
  sqlite: Sqlite;
  config: {
    internalToken: string;
    jobTokenSecret: string;
    blobSigningKey: string;
    appOrigin: string;
    publicOrigin: string;
    roomsInternalUrl: string;
    roomsInternalSecret: string;
    roomGrantSecret: string;
    gamesOrigin: string;
    commitInternalUrl: string;
    commitServiceToken: string;
    gameTemplateRef: string;
    // The instance repository every game lives in, parsed from OGM_INSTANCE_REPO.
    instanceRepo: { owner: string; name: string };
    gamesRoot: string;
    vapidKeyFile: string;
    vapidSubject: string;
    // Build chat: the relay starts only with a workspaces root; the progress poller only with a period.
    builderWorkspacesRoot?: string;
    chatPollMs?: number;
    commandPollMs?: number;
    // How long an open design Command waits for the player before its provisional default answers it.
    designDefaultMs: number;
    analyticsRetentionDays: number;
    // Both unset until the voice host is configured; the token route answers 503 meanwhile.
    voiceTokenSecret?: string;
    voiceWsUrl?: string;
    voiceHostInternalUrl?: string;
    voiceInternalSecret?: string;
    narrationConcurrency: number;
    defaultDailyAllowanceMicroUsd: number;
    resetZoneDefault: string;
    intakeDir?: string;
    reportBundleMaxBytes: number;
    blobPutMaxBytes: number;
  };
  blobStore: BlobStore;
  events: AppEvents;
  registry: Registry;
  // A daemon is keyed by the game it builds, so routes reach it through the game id on the job they hold.
  aiurClientForGame: (gameId: string) => Promise<AiurClient>;
  version: string;
  startedAtMs: number;
  log: (line: LogLine) => void;
}

export type ApiBindings = {
  Variables: { deps: AppDeps; principal: Principal; requestId: string };
};
