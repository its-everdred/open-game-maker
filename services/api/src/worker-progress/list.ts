import { workerProgress, type WorkerProgress } from './progress.js';

type WorkerClient = {
  state(signal?: AbortSignal): Promise<{ running: Record<string, unknown>[] }>;
  progress(
    ticket: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<{ progress: { status: string; percent?: number } }>;
};
export type Worker = WorkerProgress & { ticket: string; title: string; startedAt?: string };

// The daemon belongs to one game. Only expose creator-facing fields, never its workspace or host details.
export async function listWorkers(
  client: WorkerClient,
  readWorkpad: (ticket: string) => Promise<string>,
): Promise<Worker[]> {
  const snapshot = await client.state(AbortSignal.timeout(10_000));
  const active = snapshot.running.filter(
    (entry) =>
      typeof entry.issue_identifier === 'string' &&
      entry.issue_identifier.length > 0 &&
      entry.tracker_paused !== true &&
      !['paused', 'deactivated'].includes(String(entry.work_state)) &&
      !['human-review', 'ci-wait', 'done', 'cancelled'].includes(String(entry.state).replace(/^[^:]+:/, '')),
  );
  return Promise.all(
    active.map(async (entry) => {
      const ticket = entry.issue_identifier as string;
      const reading = await client.progress(ticket, undefined, AbortSignal.timeout(10_000)).catch(() => undefined);
      const value = reading?.progress.status === 'known' ? reading.progress.percent : undefined;
      const percent =
        typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
      const workpad = percent === undefined ? await readWorkpad(ticket).catch(() => '') : undefined;
      const runtimeSeconds = typeof entry.runtime_seconds === 'number' ? entry.runtime_seconds : Number.NaN;
      const rawTitle =
        typeof entry.short_summary === 'string' && entry.short_summary.trim()
          ? entry.short_summary
          : typeof entry.title === 'string'
            ? entry.title
            : 'Building';
      const title = rawTitle.trim().split(/\s+/).slice(0, 4).join(' ') || 'Building';
      const startedAt =
        typeof entry.started_at === 'string' && Number.isFinite(Date.parse(entry.started_at))
          ? entry.started_at
          : undefined;
      return {
        ticket,
        title,
        ...(startedAt ? { startedAt } : {}),
        ...workerProgress({ percent, runtimeSeconds, workpad }),
      };
    }),
  );
}
