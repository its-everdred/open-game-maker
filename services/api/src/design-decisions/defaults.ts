import type { Sqlite } from '@ogm/db';

import type { ChatJob, ChatJobDirectory } from '../app/registry.js';
import type { LogLine } from '../app/types.js';
import { listCommands, parseCommand, type ChatRow } from '../build-chat/store.js';
import { isDesignJob } from './store.js';

export type DesignDefaultsDeps = {
  sqlite: Sqlite;
  jobs: () => ChatJobDirectory | null;
  // Answers the Command through the same path the player's answer takes, so the decision history, the aiur Decision
  // and the Executor's notification do not depend on who answered.
  answer: (input: { job: ChatJob; row: ChatRow; optionId: string }) => Promise<{ answered: boolean; reason?: string }>;
  // How long an open design Command waits for the player, and how often the sweep looks. The sweep runs at a fraction
  // of the wait so a Command defaults close to its window rather than up to a whole window late.
  defaultMs: number;
  intervalMs: number;
  log: (line: LogLine) => void;
  now?: () => Date;
};

// Answers a New Game design Command with its recommended option once the wait has passed without a reply. The default
// is provisional: it unblocks the tickets waiting on the Command and the Executor is told, so the player can still
// change it and the Executor re-plans from the later answer.
export function createDesignDefaultSweep(deps: DesignDefaultsDeps) {
  const failed = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let started = false;
  const now = deps.now ?? (() => new Date());

  async function tick(): Promise<number> {
    if (running) return 0;
    running = true;
    let answered = 0;
    try {
      const jobs = deps.jobs();
      if (!jobs) return 0;
      for (const job of await jobs.active()) {
        if (!isDesignJob(job.kind) || !job.aiur) continue;
        answered += await sweepJob(job);
      }
    } catch (error) {
      // A sweep that cannot read the job directory must not become an unhandled rejection in its timer: the next tick
      // tries again, and the operator sees why this one did nothing.
      deps.log({ event: 'design-default-error', error: error instanceof Error ? error.name : 'unknown' });
      return 0;
    } finally {
      running = false;
    }
    return answered;
  }

  async function sweepJob(job: ChatJob): Promise<number> {
    let count = 0;
    const nowMs = now().getTime();
    for (const row of listCommands(deps.sqlite, job.jobId)) {
      const command = parseCommand(row);
      if (command === null || command.status !== 'open') continue;
      // A Command with no correlated aiur decision or no recommendation cannot default: there is nothing to take.
      if (command.decision_id === '' || command.version === undefined) continue;
      const recommended = command.recommend;
      if (recommended === undefined) continue;
      const openedMs = Date.parse(row.at);
      if (!Number.isFinite(openedMs) || nowMs - openedMs < deps.defaultMs) continue;
      try {
        const outcome = await deps.answer({ job, row, optionId: recommended });
        if (!outcome.answered) {
          if (!failed.has(row.id)) {
            deps.log({
              event: 'design-default-skipped',
              jobId: job.jobId,
              commandId: row.id,
              reason: outcome.reason ?? 'unknown',
            });
          }
          failed.add(row.id);
          continue;
        }
        failed.delete(row.id);
        count += 1;
      } catch (error) {
        failed.add(row.id);
        deps.log({
          event: 'design-default-error',
          jobId: job.jobId,
          commandId: row.id,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    return count;
  }

  function start(): void {
    if (started) return;
    started = true;
    const schedule = async () => {
      await tick();
      if (!started) return;
      timer = setTimeout(() => void schedule(), deps.intervalMs);
      timer.unref();
    };
    timer = setTimeout(() => void schedule(), deps.intervalMs);
    timer.unref();
  }

  return {
    tick,
    start,
    stop() {
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// The sweep's period: a quarter of the wait, between one second and half a minute. A test instance that shortens the
// wait also shortens the sweep, so a default lands promptly without a clock.
export function designDefaultInterval(defaultMs: number): number {
  return Math.max(1_000, Math.min(30_000, Math.floor(defaultMs / 4)));
}
