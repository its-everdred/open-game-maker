import { AiurHttpError } from '@ogm/aiur-client';

import type { FeedDeps, RunningDaemon } from './types.js';
import { terminalSnapshot } from './terminal-snapshot.js';

// What the feed lacks: the agent's phase and percent, and the tracker label with its waiting reasons.
export function createPollers(deps: FeedDeps) {
  const log = deps.log ?? (() => undefined);

  async function each(
    running: RunningDaemon[],
    what: string,
    read: (daemon: RunningDaemon, ticket: string) => Promise<void>,
  ): Promise<void> {
    for (const daemon of running) {
      for (const job of await deps.activeJobs(daemon.slug)) {
        await read(daemon, job.ticket).catch((error: unknown) =>
          log({ event: `aiur-${what}-poll-failed`, daemon: daemon.slug, ticket: job.ticket, error: String(error) }),
        );
      }
    }
  }

  return {
    progress: (running: RunningDaemon[]) =>
      each(running, 'progress', async (daemon, ticket) =>
        deps.apply.progress(daemon.slug, ticket, await daemon.client.progress(ticket)),
      ),
    issue: (running: RunningDaemon[]) =>
      each(running, 'issue', async (daemon, ticket) => {
        try {
          const issue = await daemon.client.issue(ticket);
          deps.apply.issue(daemon.slug, ticket, issue);
          if (terminalSnapshot(issue)) await deps.onMissingIssue?.(daemon.slug, ticket);
        } catch (error) {
          if (error instanceof AiurHttpError && error.status === 404 && deps.onMissingIssue) {
            await deps.onMissingIssue(daemon.slug, ticket);
            return;
          }
          throw error;
        }
      }),
  };
}
