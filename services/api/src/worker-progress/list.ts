import { workerProgress, type WorkerProgress } from './progress.js';

type WorkerClient = {
  baseUrl?: string;
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
  ticketDetail?(
    ticket: string,
    signal?: AbortSignal,
  ): Promise<{ live?: { activity?: string | null } | null; summary?: { text: string } | null }>;
};
type ListOptions = {
  /** The ticket's Agent Workpad comment, for a checklist percent when aiur has no reading. */
  workpad?(ticket: string): Promise<string>;
};
export type Worker = WorkerProgress & {
  ticket: string;
  title: string;
  startedAt?: string;
  elapsedSeconds?: number;
  state?: string;
  phase?: string;
  running?: boolean;
  /** One plain line on where the ticket stands: aiur's live activity, else its summary. */
  last?: string;
};

const LAST_TTL_MS = 30_000;
const LAST_MAX = 500;
const lastLines = new Map<string, { line: string | undefined; expires: number }>();
/**
 * The workpad and the last line only decorate a row, so neither may hold the 5 s poll: past this budget the row goes
 * without, while the read carries on and fills its cache for the next poll.
 */
export const ENRICH_BUDGET_MS = 3_000;

function within<T>(read: Promise<T | undefined>, ms = ENRICH_BUDGET_MS): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([read.catch(() => undefined), late]).finally(() => clearTimeout(timer));
}

// The detail is a larger read than progress; the menu polls every few seconds, so one read per ticket is kept briefly.
async function lastLine(client: WorkerClient, ticket: string): Promise<string | undefined> {
  if (!client.ticketDetail) return undefined;
  const key = `${client.baseUrl ?? ''}\n${ticket}`;
  const cached = lastLines.get(key);
  if (cached && cached.expires > Date.now()) return cached.line;
  const detail = await client.ticketDetail(ticket, AbortSignal.timeout(10_000)).catch(() => undefined);
  const raw = detail?.live?.activity?.trim() || detail?.summary?.text.trim() || '';
  const line = raw ? raw.split('\n')[0]!.slice(0, 200) : undefined;
  if (lastLines.size >= LAST_MAX && !lastLines.has(key)) lastLines.delete(lastLines.keys().next().value!);
  lastLines.set(key, { line, expires: Date.now() + LAST_TTL_MS });
  return line;
}

// The daemon belongs to one game. Only expose creator-facing fields, never its workspace or host details.
export async function listWorkers(client: WorkerClient, options: ListOptions = {}): Promise<Worker[]> {
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
        typeof entry.title === 'string' && entry.title.trim()
          ? entry.title
          : typeof entry.short_summary === 'string'
            ? entry.short_summary
            : `Ticket #${ticket}`;
      const title = rawTitle.trim() || `Ticket #${ticket}`;
      const startedAt =
        typeof entry.started_at === 'string' && Number.isFinite(Date.parse(entry.started_at))
          ? entry.started_at
          : undefined;
      const state = String(entry.state ?? '').replace(/^[^:]+:/, '');
      const waiting = !snapshot.running.includes(entry) && ['human-review', 'ci-wait', 'merging'].includes(state);
      const phase = reading?.phase?.status === 'known' ? reading.phase.value : undefined;
      // Only aiur's own "unknown" answer hands progress to the checklist; a failed read stays unknown, so a timeout
      // never shows an old checklist's 100%.
      const unknown = reading?.progress.status === 'unknown';
      const [workpad, last] = await Promise.all([
        waiting || !unknown || !options.workpad ? undefined : within(options.workpad(ticket)),
        waiting ? undefined : within(lastLine(client, ticket)),
      ]);
      return {
        ticket,
        title,
        ...(snapshot.running.includes(entry) ? { running: true } : {}),
        ...(startedAt ? { startedAt } : {}),
        ...(Number.isFinite(runtimeSeconds) && runtimeSeconds >= 0
          ? { elapsedSeconds: Math.floor(runtimeSeconds) }
          : {}),
        ...(state ? { state } : {}),
        ...(phase ? { phase } : {}),
        ...(last ? { last } : {}),
        ...workerProgress({ percent: waiting ? undefined : percent, runtimeSeconds, workpad }),
      };
    }),
  );
}
