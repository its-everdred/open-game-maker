import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Sqlite } from '@ogm/db';

import type { LogLine } from '../app/types.js';
import { workspaceForJob } from '../build-chat/outbox-relay.js';

export type CommandInboxRecord = {
  command_id: string;
  decision_id: string;
  option_id?: string;
  status: 'answered' | 'moot';
  at: string;
};

type InboxDeps = { sqlite: Sqlite; log: (line: LogLine) => void };
const safeName = /^[A-Za-z0-9_-]{1,200}$/;

async function atomicJson(directory: string, name: string, record: CommandInboxRecord): Promise<void> {
  if (!safeName.test(name)) throw new Error('command_inbox_name_invalid');
  const target = join(directory, `${name}.json`);
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

export function createInboxWriter(deps: InboxDeps) {
  const missing = new Set<string>();

  return {
    async write(jobId: string, record: CommandInboxRecord): Promise<boolean> {
      const workspace = workspaceForJob(deps.sqlite, jobId);
      if (workspace === null) {
        if (!missing.has(jobId)) deps.log({ event: 'command-inbox-workspace-missing', jobId });
        missing.add(jobId);
        return false;
      }
      missing.delete(jobId);
      const directory = join(workspace, '.gm', 'inbox', 'commands');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await atomicJson(directory, record.command_id, record);
      if (record.decision_id !== '' && record.decision_id !== record.command_id) {
        await atomicJson(directory, record.decision_id, record);
      }
      return true;
    },
  };
}

export type InboxWriter = ReturnType<typeof createInboxWriter>;
