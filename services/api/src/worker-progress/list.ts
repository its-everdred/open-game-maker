import { workerProgress, type WorkerProgress } from './progress.js';

type WorkerClient = {
  state(): Promise<{ running: Record<string, unknown>[] }>;
  progress(ticket: string): Promise<{ progress: { status: string; percent?: number } }>;
};
export type Worker = WorkerProgress & { ticket: string; title: string };

// The daemon belongs to one game. Only expose creator-facing fields, never its workspace or host details.
export async function listWorkers(
  client: WorkerClient,
  readWorkpad: (ticket: string) => Promise<string>,
): Promise<Worker[]> {
  const snapshot = await client.state();
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
      const reading = await client.progress(ticket).catch(() => undefined);
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
      return { ticket, title, ...workerProgress({ percent, runtimeSeconds, workpad }) };
    }),
  );
}
