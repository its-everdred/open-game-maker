import { workerProgress, type WorkerProgress } from './progress.js';

type WorkerClient = {
  state(signal?: AbortSignal): Promise<{
    running: Record<string, unknown>[];
    idle?: Record<string, unknown>[];
    retrying?: Record<string, unknown>[];
  }>;
  progress(
    ticket: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<{ progress: { status: string; percent?: number }; phase?: { status: string; value?: string | null } }>;
};
export type Worker = WorkerProgress & {
  ticket: string;
  title: string;
  startedAt?: string;
  elapsedSeconds?: number;
  state?: string;
  phase?: string;
};

// The daemon belongs to one game. Only expose creator-facing fields, never its workspace or host details.
export async function listWorkers(client: WorkerClient): Promise<Worker[]> {
  const snapshot = await client.state(AbortSignal.timeout(10_000));
  const seen = new Set<string>();
  const active = [...snapshot.running, ...(snapshot.idle ?? []), ...(snapshot.retrying ?? [])].filter(
    (entry) =>
      typeof entry.issue_identifier === 'string' &&
      entry.issue_identifier.length > 0 &&
      !seen.has(entry.issue_identifier) &&
      String(entry.work_state) !== 'deactivated' &&
      (String(entry.work_state) !== 'paused' ||
        ['human-review', 'ci-wait', 'merging'].includes(String(entry.state).replace(/^[^:]+:/, ''))) &&
      !['done', 'cancelled', 'canceled'].includes(String(entry.state).replace(/^[^:]+:/, '')) &&
      Boolean(seen.add(entry.issue_identifier)),
  );
  return Promise.all(
    active.map(async (entry) => {
      const ticket = entry.issue_identifier as string;
      const reading = await client.progress(ticket, undefined, AbortSignal.timeout(10_000)).catch(() => undefined);
      const value = reading?.progress.status === 'known' ? reading.progress.percent : undefined;
      const percent =
        typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
      const runtimeSeconds = typeof entry.runtime_seconds === 'number' ? entry.runtime_seconds : Number.NaN;
      const rawTitle =
        typeof entry.short_summary === 'string' && entry.short_summary.trim()
          ? entry.short_summary
          : typeof entry.title === 'string'
            ? entry.title
            : `Ticket #${ticket}`;
      const title = rawTitle.trim() || `Ticket #${ticket}`;
      const startedAt =
        typeof entry.started_at === 'string' && Number.isFinite(Date.parse(entry.started_at))
          ? entry.started_at
          : undefined;
      const state = String(entry.state ?? '').replace(/^[^:]+:/, '');
      const waiting = ['human-review', 'ci-wait', 'merging'].includes(state);
      const phase = reading?.phase?.status === 'known' ? reading.phase.value : undefined;
      return {
        ticket,
        title,
        ...(startedAt ? { startedAt } : {}),
        ...(Number.isFinite(runtimeSeconds) && runtimeSeconds >= 0
          ? { elapsedSeconds: Math.floor(runtimeSeconds) }
          : {}),
        ...(state ? { state } : {}),
        ...(phase ? { phase } : {}),
        ...workerProgress({ percent: waiting ? undefined : percent, runtimeSeconds }),
      };
    }),
  );
}
