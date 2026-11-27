import { api, ApiError } from '../../lib/api/client';
import type { BugCapture } from '../game-menu/BugComposer';
import { bugContext, setBugContext, type BugContext } from './slice';

// POST /api/v1/reports (OGM-015). When the route cannot be reached, a text-only report waits in localStorage and is
// sent on the next load. Captures stay out of that account-agnostic queue to avoid replaying one player's images for
// another signed-in user.
export type ReportError = { type: string; message: string; frames: string[] };
// #1408 extends the report service to persist screenshot attachments from this optional client field.
export type Report = BugContext & { text?: string; error?: ReportError; captures?: BugCapture[] };
export type ReportResult =
  { reportId: string; route?: string; jobId?: string; pendingBudget?: true; resetsAt?: string } | { queued: true };

const QUEUE_KEY = 'ogm.reports.queue';
const FRAMES = 5;

let lastError: ReportError | undefined;

/** The last uncaught error's summary, for the log a bug report carries. */
export function lastReportError(): ReportError | undefined {
  return lastError;
}

type ErrorContext = { route?: string; gameId?: string };

export async function sendReport(input: { text?: string; captures?: BugCapture[] }): Promise<ReportResult> {
  const report: Report = { ...bugContext(), text: input.text, error: lastError, captures: input.captures };
  try {
    return await post(report);
  } catch (e) {
    if (!unreachable(e)) throw e;
    const queuedReport = { ...report };
    delete queuedReport.captures;
    if (!writeQueue([...readQueue(), queuedReport])) throw new Error('report_queue_unavailable', { cause: e });
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
  return api<{ reportId: string; route?: string; jobId?: string; pendingBudget?: true; resetsAt?: string }>(
    '/reports',
    { method: 'POST', json: report },
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

function writeQueue(queue: Report[]): boolean {
  try {
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}
