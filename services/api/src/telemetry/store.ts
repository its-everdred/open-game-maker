import { createHash } from 'node:crypto';

import type { ClientEvent } from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';

import { frameFile, normaliseMessage } from '../reports/signature.js';

export const RETENTION_DAYS = 30;

type Crash = Extract<ClientEvent, { kind: 'crash' }>;

// The first `<url>:<line>:<col>` in a stack, without origin, build path or position.
export function topFrame(stack: string | undefined): string {
  const match = stack?.match(/[a-z][a-z0-9+.-]*:\/\/[^\s()]+?(?=:\d+:\d+)/i);
  return match ? frameFile(match[0]) : '';
}

// One signature per (game, failure kind, normalised message, top frame); the build is part of the group, not the signature,
// so the same error in a new build is recognised as a known crash.
export function crashSignature(event: Pick<Crash, 'crash' | 'message' | 'stack' | 'gameId'>): string {
  const text = [event.crash, normaliseMessage(event.message), topFrame(event.stack), event.gameId ?? ''].join('|');
  return createHash('sha256').update(text).digest('hex');
}

function detail(event: ClientEvent): Record<string, unknown> {
  switch (event.kind) {
    case 'app_open':
      return { resumed: event.resumed };
    case 'session_end':
      return { reason: event.reason };
    case 'crash':
      return {
        crash: event.crash,
        step: event.step,
        message: event.message,
        stack: event.stack,
        breadcrumbs: event.breadcrumbs,
      };
    default:
      return {};
  }
}

export function recordEvents(
  sqlite: Sqlite,
  input: { userId: string; events: readonly ClientEvent[]; now: Date },
): { stored: number } {
  const receivedAt = input.now.toISOString();
  const insert = sqlite.prepare(
    `INSERT INTO client_events
       (received_at, at, kind, user_id, session_id, origin, app_version, device, game_id, build_id, signature, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const group = sqlite.prepare(
    `INSERT INTO crash_groups
       (game_id, build_id, signature, crash, message, count, first_seen_at, last_seen_at, first_event_id, last_event_id)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT (game_id, build_id, signature)
     DO UPDATE SET count = count + 1, last_seen_at = excluded.last_seen_at, last_event_id = excluded.last_event_id`,
  );
  sqlite.transaction(() => {
    for (const event of input.events) {
      const signature = event.kind === 'crash' ? crashSignature(event) : null;
      const { lastInsertRowid } = insert.run(
        receivedAt,
        event.at,
        event.kind,
        input.userId,
        event.sessionId,
        event.origin,
        event.appVersion,
        event.device,
        event.gameId ?? null,
        event.buildId ?? null,
        signature,
        JSON.stringify(detail(event)),
      );
      if (event.kind !== 'crash' || signature === null) continue;
      const id = Number(lastInsertRowid);
      group.run(
        event.gameId ?? '',
        event.buildId ?? '',
        signature,
        event.crash,
        event.message,
        receivedAt,
        receivedAt,
        id,
        id,
      );
    }
  })();
  return { stored: input.events.length };
}

// Raw events age out; crash groups keep their counts.
export function pruneEvents(sqlite: Sqlite, now: Date): number {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return sqlite.prepare('DELETE FROM client_events WHERE received_at < ?').run(cutoff).changes;
}
