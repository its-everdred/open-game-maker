import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { BlobStore } from '@ogm/blob-store';
import type { AgentOutboxLine, NotificationTrigger } from '@ogm/contracts';
import type { Db, Sqlite } from '@ogm/db';

import type { LogLine } from '../app/types.js';
import type { NarrationLineInput, NarrationResult } from '../narration/render.js';

// What a handler gets for one outbox line. `workspaceRoot` is host-side only: never put it in a row or a response.
export interface OutboxContext {
  jobId: string;
  workspaceRoot: string;
  db: Db;
  sqlite: Sqlite;
  blobStore: BlobStore;
  renderNarration?: (lines: readonly NarrationLineInput[]) => Promise<NarrationResult[]>;
  publish: (jobId: string) => void;
  notify: (trigger: NotificationTrigger) => void;
  log: (line: LogLine) => void;
}

export interface OutboxHandler {
  type: string;
  /** Older line types the same handler still reads. */
  aliasTypes?: readonly string[];
  handle(line: AgentOutboxLine, ctx: OutboxContext): Promise<void>;
}

const contextName = /^[a-z][a-z0-9-]*$/;
const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

// Collects `<root>/<context>/outbox.<ext>` modules exporting `type` and `handle`, in name order (the routes scan's
// layout). Two modules claiming one type is a startup error.
export async function loadOutboxHandlers(root?: URL): Promise<Map<string, OutboxHandler>> {
  const directory = fileURLToPath(root ?? new URL('../', import.meta.url));
  const handlers = new Map<string, OutboxHandler>();
  const contexts = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'app' && contextName.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const context of contexts) {
    const file = `${directory}/${context}/outbox.${extension}`;
    if (!existsSync(file)) continue;
    const module = (await import(pathToFileURL(file).href)) as Partial<OutboxHandler>;
    if (typeof module.type !== 'string' || typeof module.handle !== 'function') {
      throw new Error(`${context}/outbox.${extension}: must export type and handle`);
    }
    for (const type of [module.type, ...(module.aliasTypes ?? [])]) {
      if (handlers.has(type)) throw new Error(`${context}/outbox.${extension}: ${type} is already handled`);
      handlers.set(type, { type, handle: module.handle });
    }
  }
  return handlers;
}
