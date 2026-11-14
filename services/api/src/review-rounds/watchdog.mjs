import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadEnv } from '@ogm/config';

const exec = promisify(execFile);

export async function alertOperator(
  stale,
  path = join(homedir(), '.local/state/ogm/review-watchdog.json'),
  broadcast = exec,
) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ stale, at: new Date().toISOString() }), { mode: 0o600 });
  await rename(temporary, path);
  if (stale) {
    // The durable status is authoritative on headless hosts; terminal broadcast is supplemental.
    await broadcast('/usr/bin/wall', ['OGM review reconciler stopped or the API is unavailable. Check ogm-status.'], {
      timeout: 5000,
    }).catch(() => {});
  }
}

// Runs outside the API process so an unavailable API also triggers an operator alarm.
export async function reviewHealthy(port, timeoutMs, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json();
    return response.ok && body?.details?.review_rounds?.ok === true;
  } catch {
    return false;
  }
}

export function startReviewWatchdog({ port, intervalMs, log, check = reviewHealthy, alert = alertOperator }) {
  let alerted = false;
  let initialized = false;
  let stopped = false;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    const healthy = await check(port, Math.max(1, Math.floor(intervalMs / 2)));
    if (stopped) {
      running = false;
      return;
    }
    if (!healthy && !alerted) {
      log({ event: 'admin-alert', code: 'review_reconciler_stale' });
      try {
        await alert(true);
        alerted = true;
        initialized = true;
      } catch {
        log({ event: 'admin-alert', code: 'review_alert_delivery_failed' });
      }
    }
    if (healthy && (!initialized || alerted)) {
      try {
        await alert(false);
        if (alerted) log({ event: 'review_reconciler_recovered' });
        alerted = false;
        initialized = true;
      } catch {
        log({ event: 'admin-alert', code: 'review_alert_delivery_failed' });
      }
    }
    running = false;
  }
  const timer = setInterval(tick, Math.max(1, Math.floor(intervalMs / 2)));
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadEnv('review-watchdog', {
    OGM_API_PORT: { kind: 'port' },
    OGM_COMMAND_POLL_MS: { kind: 'int', default: '5000' },
  });
  const port = env.OGM_API_PORT;
  const intervalMs = env.OGM_COMMAND_POLL_MS;
  if (intervalMs < 1) throw new Error('invalid review watchdog configuration');
  startReviewWatchdog({ port, intervalMs, log: (line) => console.error(JSON.stringify(line)) });
}
