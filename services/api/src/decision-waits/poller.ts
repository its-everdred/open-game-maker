import type { AiurClient } from '@ogm/aiur-client';

import type { LogLine } from '../app/types.js';
import { isAnswered, releaseDecision } from './release.js';
import type { WaitTickets } from './tickets.js';

type PollerDeps = {
  // Every game daemon that can answer: its slug and the repository its tickets live in.
  daemons: () => Promise<{ slug: string; repo: string }[]>;
  clientFor: (slug: string) => Promise<AiurClient | null>;
  tickets: WaitTickets;
  log: (line: LogLine) => void;
};

// Each poll reads every game's aiur decisions and releases what the newly answered ones hold (#680), whoever answered:
// the app, voice, the aiur dashboard. GitHub is read only when a decision is newly answered, once per repository. A
// decision is done once its release succeeds; a failure leaves it for the next poll. Restarting reads every answered
// decision once more, which finds no labels left for the ones already released.
const DECISION_PAGE = 100;

export function createDecisionWaitPoller(deps: PollerDeps) {
  const done = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function pollDaemon(slug: string, repo: string): Promise<void> {
    const client = await deps.clientFor(slug);
    if (client === null) return;
    const fresh = (await client.decisions({ limit: DECISION_PAGE })).filter(
      (decision) => isAnswered(decision) && !done.has(`${repo}\0${decision.decision_id}@${decision.version}`),
    );
    if (fresh.length === 0) return;
    const labelled = new Set(await deps.tickets.keys(repo));
    for (const decision of fresh) {
      const released = await releaseDecision(client, deps.tickets, repo, labelled, decision);
      for (const { key, ticket, outcome } of released) {
        deps.log({ event: 'decision_wait_released', slug, decisionId: decision.decision_id, key, ticket, outcome });
      }
      done.add(`${repo}\0${decision.decision_id}@${decision.version}`);
    }
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (const { slug, repo } of await deps.daemons()) {
        try {
          await pollDaemon(slug, repo);
        } catch (error) {
          deps.log({ event: 'decision_wait_poll_error', slug, error: (error as Error).name });
        }
      }
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
