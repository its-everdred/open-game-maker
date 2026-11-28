import { constants } from 'node:fs';
import { open, readdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AppDeps } from '../app/types.js';
import { appCheckRecordBody, recordChecks } from './check-records.js';

/** Replay deploy records after an API outage; the sender can safely retry the same record concurrently. */
export async function drainAppCheckQueue(
  deps: AppDeps,
  root = join(homedir(), '.local/state/ogm/app-publish-checks'),
): Promise<void> {
  const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const name of names.filter((item) => /^[0-9a-f-]{36}\.json$/u.test(item)).sort()) {
    const path = join(root, name);
    try {
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let raw: string;
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 65_536) throw new Error('invalid record file');
        raw = await file.readFile('utf8');
      } finally {
        await file.close();
      }
      const record = appCheckRecordBody.parse(JSON.parse(raw));
      if (`${record.recordId}.json` !== name) throw new Error('record identifier mismatch');
      recordChecks(deps, null, record);
      await unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') deps.log({ event: 'app_publish_record_recovery_failed' });
    }
  }
}

export function startAppCheckQueue(deps: AppDeps): () => Promise<void> {
  let running: Promise<void> | null = null;
  let stopped = false;
  const drain = () => {
    if (stopped || running) return;
    running = drainAppCheckQueue(deps)
      .catch(() => deps.log({ event: 'app_publish_record_recovery_failed' }))
      .finally(() => {
        running = null;
      });
  };
  drain();
  const timer = setInterval(drain, 30_000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
