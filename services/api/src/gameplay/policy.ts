import type { Context } from 'hono';

import { schema, type Db } from '@ogm/db';
import { eq } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import type { ApiBindings } from '../app/types.js';

// Kevin (2026-11-08): agents build games; playing them spends no tokens and no paid API. One instance-wide switch,
// off unless an instance admin turns it on.
const KEY = 'gameplay.paid_apis';

export function paidApisDuringGameplay(db: Db): boolean {
  return (
    db.select({ value: schema.appMeta.value }).from(schema.appMeta).where(eq(schema.appMeta.key, KEY)).get()?.value ===
    'on'
  );
}

export function setPaidApisDuringGameplay(db: Db, allowed: boolean): void {
  const value = allowed ? 'on' : 'off';
  db.insert(schema.appMeta)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.appMeta.key, set: { value } })
    .run();
}

// A request is gameplay unless it carries no Origin (a service or the builder) or the app's own Origin. Origin and
// Referer are set by the browser, so a game cannot unset them; no header, query or body field the caller chooses can
// make a game's request count as development. A sandboxed frame's opaque `null` origin is gameplay too.
export function isGameplayRequest(c: Context<ApiBindings>): boolean {
  const { appOrigin, gamesOrigin } = c.get('deps').config;
  const games = new URL(gamesOrigin).origin;
  const origin = c.req.header('origin');
  if (origin !== undefined && origin !== new URL(appOrigin).origin) return true;
  const referer = c.req.header('referer');
  if (referer === undefined) return false;
  try {
    return new URL(referer).origin === games;
  } catch {
    return true;
  }
}

// The metered-service boundary: every route that can dispatch to a paid provider calls this before it dispatches.
export function requireMeteredDispatch(c: Context<ApiBindings>): void {
  if (isGameplayRequest(c) && !paidApisDuringGameplay(c.get('deps').db)) {
    throw new HttpError(403, 'paid_apis_off_during_gameplay');
  }
}
