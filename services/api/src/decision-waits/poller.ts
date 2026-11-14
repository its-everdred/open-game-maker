import type { AiurClient, Decision } from '@ogm/aiur-client';

import type { LogLine } from '../app/types.js';
import { isAnswered, keysOf, releaseKey } from './release.js';
import type { WaitTickets } from './tickets.js';

type PollerDeps = {
  // Every game daemon that can answer: its slug and the repository its tickets live in.
  daemons: () => Promise<{ slug: string; repo: string }[]>;
  clientFor: (slug: string) => Promise<AiurClient | null>;
  tickets: WaitTickets;
  syncReviewRounds?: () => Promise<void>;
  log: (line: LogLine) => void;
  now?: () => number;
};

// Each poll reads every game's aiur decisions and releases the tickets waiting on answered ones (#680), whoever
// answered: the app, voice, the aiur dashboard. The repository's `waits:` labels are what is waiting, so they are read
// when a decision is newly answered and at least once a minute: a ticket parked on a decision answered earlier is still
// released, and one that failed part-way is retried. A key names the newest decision that carries it, so a question
// asked again under the same key is waited on afresh, not answered by the old reply.
const DECISION_PAGE = 100;
export const LABEL_REREAD_MS = 60_000;

function newestByKey(decisions: readonly Decision[]): Map<string, Decision> {
  const newest = new Map<string, Decision>();
  for (const decision of decisions) {
    for (const key of keysOf(decision)) {
      const seen = newest.get(key);
      if (seen === undefined || seen.created_at < decision.created_at) newest.set(key, decision);
    }
  }
  return newest;
}

export function createDecisionWaitPoller(deps: PollerDeps) {
  const now = deps.now ?? Date.now;
  const seen = new Set<string>();
  const labelsReadAt = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function pollDaemon(slug: string, repo: string): Promise<void> {
    const client = await deps.clientFor(slug);
    if (client === null) return;
    const decisions = await client.decisions({ limit: DECISION_PAGE });
    const fresh = decisions.filter((decision) => isAnswered(decision) && !seen.has(`${slug}\0${answerId(decision)}`));
    const readAt = labelsReadAt.get(`${slug}\0${repo}`);
    if (fresh.length === 0 && readAt !== undefined && now() - readAt < LABEL_REREAD_MS) return;

    const labelled = await deps.tickets.keys(repo);
    const newest = newestByKey(decisions);
    let failed = false;
    for (const key of labelled) {
      const decision = newest.get(key);
      if (decision === undefined || !isAnswered(decision)) continue;
      try {
        for (const { ticket, outcome } of await releaseKey(client, deps.tickets, repo, slug, key, decision)) {
          deps.log({ event: 'decision_wait_released', slug, decisionId: decision.decision_id, key, ticket, outcome });
        }
      } catch (error) {
        failed = true;
        deps.log({ event: 'decision_wait_release_error', slug, key, error: (error as Error).name });
      }
    }
    for (const decision of fresh) seen.add(`${slug}\0${answerId(decision)}`);
    // A failed release reads the labels again on the next poll rather than a minute later.
    if (failed) labelsReadAt.delete(`${slug}\0${repo}`);
    else labelsReadAt.set(`${slug}\0${repo}`, now());
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      if (deps.syncReviewRounds) {
        try {
          await deps.syncReviewRounds();
        } catch (error) {
          deps.log({ event: 'review_round_sync_error', error: (error as Error).name });
        }
      }
      for (const { slug, repo } of await deps.daemons()) {
        try {
          await pollDaemon(slug, repo);
        } catch (error) {
          deps.log({ event: 'decision_wait_poll_error', slug, error: (error as Error).name });
        }
      }
    } catch (error) {
      deps.log({ event: 'decision_wait_poll_error', error: (error as Error).name });
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start(intervalMs: number): void {
      if (timer) return;
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

function answerId(decision: Decision): string {
  return `${decision.decision_id}@${decision.version}`;
}
