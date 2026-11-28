import { api, ApiError } from '../../lib/api/client';
import { bugContext, setBugContext, type BugContext } from './slice';

// POST /api/v1/reports (OGM-015). A report is never lost: when the route can't be reached (offline, not deployed yet,
// a server error) it waits in localStorage and is sent on the next load. The queue holds only what the player typed,
// the screen's ids and the last error's summary.
export type ReportError = { type: string; message: string; frames: string[] };
export type Report = BugContext & {
  text?: string;
  error?: ReportError;
  screenshot?: string;
  skipRepair?: boolean;
  requestKey?: string;
};
export type ReportResult =
  { reportId: string; route?: string; jobId?: string; pendingBudget?: true; resetsAt?: string } | { queued: true };

const QUEUE_KEY = 'ogm.reports.queue';
const FRAMES = 5;

let lastError: ReportError | undefined;
let capture: { gameId: string; read: () => Promise<string | undefined> } | undefined;

export function registerReportCapture(gameId: string, read: () => Promise<string | undefined>): () => void {
  const registration = { gameId, read };
  capture = registration;
  return () => {
    if (capture === registration) capture = undefined;
  };
}

/** The last uncaught error's summary, for the log a bug report carries. */
export function lastReportError(): ReportError | undefined {
  return lastError;
}

type ErrorContext = { route?: string; gameId?: string };

export async function sendReport(input: {
  text?: string;
  skipRepair?: boolean;
  requestKey?: string;
}): Promise<ReportResult> {
  const report: Report = { ...bugContext(), ...input, error: lastError };
  if (capture && capture.gameId === report.gameId) {
    try {
      report.screenshot = await capture.read();
    } catch {
      // Older games cannot answer the capture request; the report can still be sent.
    }
  }
  try {
    return await post(report);
  } catch (e) {
    if (!unreachable(e)) throw e;
    const queuedReport = { ...report };
    delete queuedReport.screenshot;
    writeQueue([...readQueue(), queuedReport]);
    return { queued: true };
  }
}

export async function flushQueue(): Promise<void> {
  const queue = readQueue();
  const left: Report[] = [];
  for (const report of queue) {
    try {
      await post(report);
    } catch (e) {
      if (unreachable(e)) left.push(report);
    }
  }
  writeQueue(left);
}

// keep the most recent uncaught error so a report can say what broke
export function installErrorCapture(): void {
  window.addEventListener('error', (e) => {
    captureError(e.error, {}, e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    captureError(e.reason);
  });
}

export function captureError(error: unknown, context: ErrorContext = {}, fallback = String(error)): void {
  const summary = summarise(error, fallback);
  const where = [context.route, context.gameId ? `game ${context.gameId}` : undefined].filter(Boolean).join(' · ');
  lastError = where ? { ...summary, message: `${where} — ${summary.message}` } : summary;

  if (context.route) {
    const current = bugContext();
    setBugContext(current.gameId === context.gameId ? current : { gameId: context.gameId });
  }
}

function post(report: Report) {
  const error = report.error && {
    type: report.error.type.slice(0, 80),
    message: report.error.message.slice(0, 1000),
    frames: report.error.frames.flatMap((frame) => {
      const match = /(?:\(|@|\s)([^\s()]+?):(\d+)(?::(\d+))?\)?$/.exec(frame);
      if (!match) return [];
      const line = Number(match[2]);
      const col = match[3] ? Number(match[3]) : undefined;
      if (!Number.isSafeInteger(line) || (col !== undefined && !Number.isSafeInteger(col))) return [];
      return [{ file: match[1].slice(0, 300), line, ...(col !== undefined ? { col } : {}) }];
    }),
  };
  return api<{ reportId: string; route?: string; jobId?: string; pendingBudget?: true; resetsAt?: string }>(
    '/reports',
    { method: 'POST', json: { ...report, ...(error ? { error } : {}) } },
  );
}

function unreachable(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 404 || e.status === 408 || e.status === 429 || e.status >= 500;
  return e instanceof TypeError; // fetch's network failure
}

function summarise(error: unknown, fallback: string): ReportError {
  if (error instanceof Error) {
    const frames = (error.stack ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('at ') || l.includes('@'))
      .slice(0, FRAMES);
    return { type: error.name, message: error.message, frames };
  }
  return { type: 'Error', message: fallback, frames: [] };
}

function readQueue(): Report[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Report[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: Report[]): void {
  try {
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* private mode: nothing to keep it in */
  }
}
