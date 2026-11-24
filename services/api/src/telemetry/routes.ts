import { Hono } from 'hono';

import { ClientEventBatch } from '@ogm/contracts';

import { createRateLimiter } from '../auth/rate-limit.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import { readBoundedBody } from '../app/read-body.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { pruneEvents, recordEvents } from './store.js';

export const MAX_BODY_BYTES = 64 * 1024;
export const BATCHES_PER_USER_PER_HOUR = 240;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

type TelemetryContext = { perUser: ReturnType<typeof createRateLimiter>; prunedAt: number };
const contexts = new WeakMap<AppDeps, TelemetryContext>();

export function setup(deps: AppDeps): void {
  contexts.set(deps, { perUser: createRateLimiter(BATCHES_PER_USER_PER_HOUR), prunedAt: 0 });
}

function context(deps: AppDeps): TelemetryContext {
  const found = contexts.get(deps);
  if (!found) throw new Error('telemetry routes used before setup');
  return found;
}

// The app shell posts here with fetch or navigator.sendBeacon (which cannot read the reply).
export default new Hono<ApiBindings>().post('/client-events', async (c) => {
  const principal = requirePrincipal(c, ['user']);
  const deps = c.get('deps');
  const ctx = context(deps);
  if (!ctx.perUser(principal.userId)) throw new HttpError(429, 'rate_limited');

  const bytes = await readBoundedBody(c.req.raw, MAX_BODY_BYTES, 'payload_too_large');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  const parsed = ClientEventBatch.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(({ code, path, message }) => ({ code, path, message }));
    throw new HttpError(400, 'invalid_request', undefined, issues);
  }

  const now = new Date();
  const { stored } = recordEvents(deps.sqlite, { userId: principal.userId, events: parsed.data.events, now });
  if (now.getTime() - ctx.prunedAt > PRUNE_EVERY_MS) {
    ctx.prunedAt = now.getTime();
    pruneEvents(deps.sqlite, now);
  }
  return c.json({ stored }, 202);
});
