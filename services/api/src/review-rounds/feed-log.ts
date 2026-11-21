import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const logPath = join(homedir(), '.local', 'state', 'ogm', 'review-publishes.log');
const MAX_LOG_BYTES = 64 * 1024 * 1024;
const RETAIN_LOG_MS = 48 * 60 * 60 * 1000;
let appendQueue = Promise.resolve();

export type ReviewFeedItem = { ticket: string; id: string; postedAt: string };

export function appendReviewLogRecord(
  path: string,
  line: string,
  now = new Date(),
  limits: { maxBytes?: number; retainMs?: number } = {},
): Promise<void> {
  const operation = appendQueue.then(() => appendBounded(path, line, now, limits));
  appendQueue = operation.catch(() => undefined);
  return operation;
}

async function appendBounded(
  path: string,
  line: string,
  now: Date,
  limits: { maxBytes?: number; retainMs?: number },
): Promise<void> {
  const maxBytes = limits.maxBytes ?? MAX_LOG_BYTES;
  const retainMs = limits.retainMs ?? RETAIN_LOG_MS;
  const lineBytes = Buffer.byteLength(line);
  if (lineBytes > maxBytes) throw new Error('review_log_record_too_large');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const currentSize = await stat(path)
    .then((info) => info.size)
    .catch(() => 0);
  if (currentSize + lineBytes <= maxBytes) {
    await appendFile(path, line, { mode: 0o600 });
    return;
  }
  const cutoff = now.getTime() - retainMs;
  const existing = await readFile(path, 'utf8').catch(() => '');
  const retained = existing.split('\n').filter((entry) => {
    if (!entry) return false;
    try {
      const timestamp = Date.parse((JSON.parse(entry) as { timestamp?: string }).timestamp ?? '');
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    } catch {
      return false;
    }
  });
  const targetBytes = Math.floor(maxBytes * 0.75) - lineBytes;
  let retainedBytes = retained.length ? Buffer.byteLength(`${retained.join('\n')}\n`) : 0;
  while (retained.length && retainedBytes > targetBytes) {
    retainedBytes -= Buffer.byteLength(`${retained.shift()}\n`);
  }
  const compacted = retained.length ? `${retained.join('\n')}\n` : '';
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, compacted, { mode: 0o600 });
  await rename(temporary, path);
  await appendFile(path, line, { mode: 0o600 });
}

export async function logReviewFeedRefresh(
  source: string,
  gameId: string,
  items: readonly ReviewFeedItem[],
  log: (line: Record<string, unknown>) => void,
  path = logPath,
): Promise<void> {
  const line = `${JSON.stringify({ timestamp: new Date().toISOString(), event: 'feed_refresh', source, gameId, items })}\n`;
  try {
    await appendReviewLogRecord(path, line);
  } catch (error) {
    log({ event: 'review_feed_log_failed', error: (error as Error).name });
  }
}

export async function logReviewPublish(
  gameId: string,
  item: ReviewFeedItem,
  log: (line: Record<string, unknown>) => void,
  path = logPath,
): Promise<void> {
  const line = `${JSON.stringify({ timestamp: new Date().toISOString(), event: 'publish', source: 'rounds', gameId, items: [item] })}\n`;
  try {
    await appendReviewLogRecord(path, line);
  } catch (error) {
    log({ event: 'review_feed_log_failed', error: (error as Error).name });
  }
}
