import type { ClientEvent, CrashKind, PlayStep } from '@ogm/contracts/browser';

// Operator telemetry: app opens, play heartbeats and crashes go to the API, where the host listener
// tells the Executor within a minute. Nothing here may throw into the app.

const ENDPOINT = '/api/v1/telemetry/client-events';
const MAX_BATCH = 20;
const MAX_BATCH_BYTES = 48 * 1024;
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
const MAX_BREADCRUMBS = 20;
const MAX_CRASHES_PER_LOAD = 30;
const FLUSH_DELAY_MS = 1_000;
/** Back after this long away counts as opening the app again (a phone PWA is rarely reloaded). */
export const RESUME_AFTER_MS = 10 * 60 * 1000;

type Common = 'at' | 'sessionId' | 'origin' | 'appVersion' | 'device';
type Distribute<T> = T extends unknown ? Omit<T, Common> : never;
export type TelemetryEvent = Distribute<ClientEvent>;

const sessionId = crypto.randomUUID();
const breadcrumbs: string[] = [];
const crashesSeen = new Set<string>();
let queue: ClientEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export const appVersion = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev';

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** A short note of what the player just did, sent along with the next crash. */
export function breadcrumb(note: string): void {
  breadcrumbs.push(clip(note, 120));
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
}

export function track(event: TelemetryEvent): void {
  queue.push({
    ...event,
    at: new Date().toISOString(),
    sessionId,
    origin: clip(location.origin, 200),
    appVersion: clip(appVersion, 64),
    device: clip(navigator.userAgent, 200),
  } as ClientEvent);
  if (queue.length >= MAX_BATCH) flush();
  else timer ??= setTimeout(flush, FLUSH_DELAY_MS);
}

export function reportCrash(input: {
  crash: CrashKind;
  message: string;
  stack?: string;
  step?: PlayStep;
  gameId?: string;
  buildId?: string;
}): void {
  const key = `${input.crash}|${input.gameId ?? ''}|${input.buildId ?? ''}|${input.message}`;
  if (crashesSeen.has(key) || crashesSeen.size >= MAX_CRASHES_PER_LOAD) return;
  crashesSeen.add(key);
  track({
    kind: 'crash',
    crash: input.crash,
    message: clip(input.message || input.crash, 500),
    breadcrumbs: [...breadcrumbs],
    ...(input.stack ? { stack: clip(input.stack, 4000) } : {}),
    ...(input.step ? { step: input.step } : {}),
    ...(input.gameId ? { gameId: clip(input.gameId, 128) } : {}),
    ...(input.buildId ? { buildId: clip(input.buildId, 128) } : {}),
  });
}

/** Sends what is queued. `beacon` survives the page going away; fetch is used otherwise so failures stay quiet. */
export function flush(beacon = false): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  while (queue.length) {
    // Bounded by count and by size: the API takes 64 KB and a keepalive or beacon body has the same browser quota.
    let count = 1;
    let size = bytes(queue[0]);
    while (count < Math.min(queue.length, MAX_BATCH)) {
      size += bytes(queue[count]) + 1;
      if (size > MAX_BATCH_BYTES) break;
      count += 1;
    }
    const body = JSON.stringify({ events: queue.slice(0, count) });
    queue = queue.slice(count);
    if (beacon && sendBeacon(body)) continue;
    try {
      void fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body,
      }).catch(() => undefined);
    } catch {
      // Telemetry never breaks the app.
    }
  }
}

// False when the browser refused or has no beacon, so the batch goes by fetch instead of being lost.
function sendBeacon(body: string): boolean {
  try {
    return navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' })) ?? false;
  } catch {
    return false;
  }
}

function errorText(error: unknown, fallback: string): { message: string; stack?: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack };
  return { message: fallback };
}

/** Once per page load: the app-open event, session end when hidden or closed, and shell-level crashes. */
export function installTelemetry(target: Window = window, now: () => number = Date.now): () => void {
  let hiddenAt: number | undefined;
  let ended = false;
  track({ kind: 'app_open', resumed: false });

  const end = (reason: 'hidden' | 'pagehide') => {
    if (!ended) track({ kind: 'session_end', reason });
    ended = true;
    flush(true);
  };
  const onVisibility = () => {
    if (target.document.visibilityState === 'hidden') {
      hiddenAt = now();
      end('hidden');
      return;
    }
    if (hiddenAt !== undefined && now() - hiddenAt >= RESUME_AFTER_MS) track({ kind: 'app_open', resumed: true });
    hiddenAt = undefined;
    ended = false;
  };
  const onPageHide = () => end('pagehide');
  const onError = (event: ErrorEvent) =>
    reportCrash({ crash: 'shell_error', ...errorText(event.error, event.message || 'script error') });
  const onRejection = (event: PromiseRejectionEvent) =>
    reportCrash({ crash: 'shell_error', ...errorText(event.reason, String(event.reason)) });
  // Vite fires this when a lazy route chunk fails to load (often a stale tab after a deploy).
  const onPreloadError = (event: Event) =>
    reportCrash({
      crash: 'chunk_load_failed',
      ...errorText((event as Event & { payload?: unknown }).payload, 'chunk'),
    });

  target.document.addEventListener('visibilitychange', onVisibility);
  target.addEventListener('pagehide', onPageHide);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => {
    target.document.removeEventListener('visibilitychange', onVisibility);
    target.removeEventListener('pagehide', onPageHide);
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
    target.removeEventListener('vite:preloadError', onPreloadError);
  };
}
