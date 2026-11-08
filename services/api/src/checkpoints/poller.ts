import { createHash } from 'node:crypto';

import { AiurConfigError, type Decision } from '@ogm/aiur-client';
import type { Db, Sqlite } from '@ogm/db';

import type { AiurClientResolver, ChatJobDirectory } from '../app/registry.js';
import type { LogLine } from '../app/types.js';
import { isDesignJob, tryRecordDesignDecision } from '../design-decisions/store.js';
import {
  insertChatRow,
  listCheckpoints,
  parseCheckpoint,
  updateCheckpoint,
  type StoredCheckpoint,
} from '../build-chat/store.js';
import { summaryOf } from '../commands/aiur.js';
import { creatorAudience } from '../commands/audience.js';
import { correlate, pickOf, recommendationOf, statusOf } from './correlate.js';
import type { InboxWriter } from './inbox.js';

type PollerDeps = {
  db: Db;
  sqlite: Sqlite;
  jobs: () => ChatJobDirectory | null;
  clientFor: () => AiurClientResolver | null;
  inbox: InboxWriter;
  publish: (jobId: string) => void;
  log: (line: LogLine) => void;
  supervisorTokenStatus?: (daemon: string, missing: boolean) => void;
  now?: () => Date;
};

function nativeMessageId(jobId: string, decisionId: string): string {
  const hex = createHash('sha256').update(`${jobId}\0${decisionId}`).digest('hex').slice(0, 32);
  return `m_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nativeCheckpoint(decision: Decision): StoredCheckpoint {
  const recommend = recommendationOf(decision);
  const audience = creatorAudience(decision);
  const summary = summaryOf(decision);
  // A short summary only titles the Command when it is topic-sized (as `gm decide` writes it); a longer one would not
  // fit the inbox title, so the job's title stays.
  const shortSummary = decision.context?.short_summary?.trim();
  const topic = shortSummary && shortSummary.length <= 80 ? shortSummary : undefined;
  return {
    checkpoint_id: decision.decision_id,
    decision_id: decision.decision_id,
    version: decision.version,
    question: decision.question,
    options: decision.options.map(({ id, label }) => ({ id, label })),
    ...(recommend === undefined ? {} : { recommend }),
    blocking: decision.blocking,
    pick: pickOf(decision),
    ...(topic ? { topic } : {}),
    status: statusOf(decision),
    ...(audience === undefined ? {} : { audience }),
    ...(summary === undefined ? {} : { summary }),
  };
}

function changed(checkpoint: StoredCheckpoint, patch: Partial<StoredCheckpoint>): boolean {
  return Object.entries(patch).some(([key, value]) => checkpoint[key as keyof StoredCheckpoint] !== value);
}

export function createCheckpointPoller(deps: PollerDeps) {
  const failedDaemons = new Set<string>();
  const missingSupervisorTokens = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let started = false;
  const now = deps.now ?? (() => new Date());

  async function tick(): Promise<boolean> {
    if (running) return failedDaemons.size > 0;
    running = true;
    let failed = false;
    const attemptedDaemons = new Set<string>();
    const failedThisTick = new Set<string>();
    try {
      const jobs = deps.jobs();
      const clientFor = deps.clientFor();
      if (!jobs || !clientFor) return false;
      for (const job of await jobs.active()) {
        if (!job.aiur) continue;
        attemptedDaemons.add(job.aiur.daemonSlug);
        try {
          const client = await clientFor(job.aiur.daemonSlug);
          if (!client) continue;
          const decisions = (await client.decisions({ ticket: job.aiur.ticket, limit: 50 })).filter(
            ({ ticket }) => ticket.identifier === job.aiur!.ticket,
          );
          missingSupervisorTokens.delete(job.aiur.daemonSlug);
          deps.supervisorTokenStatus?.(job.aiur.daemonSlug, false);
          const plan = correlate(decisions, listCheckpoints(deps.sqlite, job.jobId));
          let published = false;
          for (const decision of plan.create) {
            const result = insertChatRow(deps.sqlite, {
              id: nativeMessageId(job.jobId, decision.decision_id),
              jobId: job.jobId,
              at: decision.created_at,
              actor: 'agent',
              kind: 'checkpoint',
              text: decision.question,
              checkpoint: nativeCheckpoint(decision),
            });
            published ||= result.inserted;
          }
          for (const action of plan.update) {
            const before = parseCheckpoint(action.row);
            if (before === null || !changed(before, action.patch)) continue;
            const status = action.patch.status;
            if (status === 'answered' || status === 'moot') {
              const after = { ...before, ...action.patch };
              await deps.inbox.write(job.jobId, {
                checkpoint_id: after.checkpoint_id ?? action.row.id,
                decision_id: after.decision_id,
                ...(after.option_id === undefined ? {} : { option_id: after.option_id }),
                status,
                at: now().toISOString(),
              });
              // An answer that reached aiur without this app answering it — voice, the aiur dashboard, the Executor —
              // still belongs in the game's decision history. The default sweep's own answers are already recorded, and
              // whoever answered already knows, so this path records the decision without messaging the Executor. A
              // failed history write must not stop the card update below or count as an aiur outage.
              if (status === 'answered' && after.option_id !== undefined && isDesignJob(job.kind)) {
                tryRecordDesignDecision(
                  deps.db,
                  {
                    gameId: job.gameId,
                    jobId: job.jobId,
                    ticket: job.aiur?.ticket ?? null,
                    checkpointId: after.checkpoint_id ?? action.row.id,
                    decisionId: after.decision_id,
                    question: after.question,
                    options: after.options.map(({ id, label }) => ({ id, label })),
                    recommended: after.recommend ?? null,
                    chosen: after.option_id,
                    origin: 'player',
                    at: now().toISOString(),
                  },
                  deps.log,
                );
              }
            }
            updateCheckpoint(deps.sqlite, action.row.id, action.patch);
            published = true;
          }
          if (published) deps.publish(job.jobId);
        } catch (error) {
          failed = true;
          failedThisTick.add(job.aiur.daemonSlug);
          if (error instanceof AiurConfigError) {
            missingSupervisorTokens.add(job.aiur.daemonSlug);
            deps.supervisorTokenStatus?.(job.aiur.daemonSlug, true);
          }
          if (!failedDaemons.has(job.aiur.daemonSlug)) {
            deps.log({
              event: 'checkpoint-poll-error',
              daemon: job.aiur.daemonSlug,
              jobId: job.jobId,
              error: (error as Error).name,
            });
          }
          failedDaemons.add(job.aiur.daemonSlug);
        }
      }
      for (const daemon of attemptedDaemons) {
        if (!failedThisTick.has(daemon)) failedDaemons.delete(daemon);
      }
      for (const daemon of failedDaemons) {
        if (!attemptedDaemons.has(daemon)) failedDaemons.delete(daemon);
      }
      for (const daemon of missingSupervisorTokens) {
        if (!attemptedDaemons.has(daemon)) {
          missingSupervisorTokens.delete(daemon);
          deps.supervisorTokenStatus?.(daemon, false);
        }
      }
    } finally {
      running = false;
    }
    return failed;
  }

  function start(intervalMs: number): void {
    if (started) return;
    started = true;
    const schedule = async () => {
      const failed = await tick();
      if (!started) return;
      timer = setTimeout(() => void schedule(), failed ? 30_000 : intervalMs);
      timer.unref();
    };
    timer = setTimeout(() => void schedule(), intervalMs);
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
