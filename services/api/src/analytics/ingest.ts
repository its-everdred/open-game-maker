import { randomUUID } from 'node:crypto';

import {
  ActivityEvent as ActivityEventSchema,
  type ActivityEvent,
  type IngestResponse,
  type Principal,
} from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { eq } from 'drizzle-orm';
import type { ZodError } from 'zod';

import { HttpError } from '../app/errors.js';
import { actorFromPrincipal } from '../accounts/families.js';
import { resolveGame, type Registry } from '../app/registry.js';
import type { LogLine } from '../app/types.js';

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

type IngestPrincipal = Extract<Principal, { kind: 'job' | 'user' }>;

function normalizedRaw(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const event = { ...(value as Record<string, unknown>) };
  if (event.meta && typeof event.meta === 'object' && !Array.isArray(event.meta)) {
    const meta = { ...(event.meta as Record<string, unknown>) };
    if (typeof meta.command === 'string') meta.command = meta.command.slice(0, 120);
    event.meta = meta;
  }
  return event;
}

function validationReason(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid event';
  const path = issue.path.join('.');
  if (issue.code === 'unrecognized_keys') {
    const label = issue.keys.length === 1 ? 'key' : 'keys';
    return `${path || 'event'}: unrecognized ${label} ${issue.keys.join(', ')}`;
  }
  return `${path ? `${path}: ` : ''}${issue.message}`;
}

function identity(event: ActivityEvent): string {
  return [event.jobId ?? event.gameId, event.ts, event.activity, event.boundary, event.source].join('\u0000');
}

export async function ingestAnalytics(input: {
  db: Db;
  registry: Registry;
  principal: IngestPrincipal;
  events: unknown[];
  log: (line: LogLine) => void;
  now?: Date;
}): Promise<IngestResponse> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const rejected: IngestResponse['rejected'] = [];
  const accepted: ActivityEvent[] = [];
  const seen = new Set<string>();
  const resolvedGames = new Map<string, Awaited<ReturnType<typeof resolveGame>>>();
  const eventFamilies = new Map<string, string>();

  for (const [index, raw] of input.events.entries()) {
    const parsed = ActivityEventSchema.safeParse(normalizedRaw(raw));
    if (!parsed.success) {
      rejected.push({ index, reason: validationReason(parsed.error) });
      continue;
    }

    const event: ActivityEvent = { ...parsed.data, ts: new Date(parsed.data.ts).toISOString() };
    const timestamp = Date.parse(event.ts);
    if (timestamp < nowMs - MAX_AGE_MS || timestamp > nowMs + MAX_FUTURE_MS) {
      rejected.push({ index, reason: 'ts_out_of_range' });
      continue;
    }
    if (event.source === 'gm_cli' && event.meta.command !== undefined && !/^gm(?:\s|$)/.test(event.meta.command)) {
      rejected.push({ index, reason: 'meta.command_invalid' });
      continue;
    }

    if (input.principal.kind === 'job') {
      if (event.gameId !== input.principal.gameId) {
        rejected.push({ index, reason: 'game_mismatch' });
        continue;
      }
      if (event.jobId !== undefined && event.jobId !== input.principal.jobId) {
        rejected.push({ index, reason: 'job_mismatch' });
        continue;
      }
      event.jobId = input.principal.jobId;
    } else {
      let game = resolvedGames.get(event.gameId);
      if (game === undefined) {
        game = await resolveGame(input.registry, event.gameId);
        resolvedGames.set(event.gameId, game);
      }
      if (!game) throw new HttpError(403, 'game_unresolved');
      if (game.familyId !== input.principal.familyId) {
        const row = input.db.select().from(schema.games).where(eq(schema.games.id, event.gameId)).get();
        if (
          !row ||
          !authorize(actorFromPrincipal(input.principal), 'game.play', {
            familyId: row.familyId,
            ownerId: row.ownerId,
            visibility: row.visibility,
            published: row.publishedReleaseId !== null,
          }).ok
        )
          throw new HttpError(403, 'game_unresolved');
      }
      eventFamilies.set(event.gameId, game.familyId);
      if (event.jobId !== undefined) {
        rejected.push({ index, reason: 'job_not_allowed' });
        continue;
      }
      if (event.actor !== 'human') {
        rejected.push({ index, reason: 'actor_not_human' });
        continue;
      }
    }

    const key = identity(event);
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(event);
  }

  if (accepted.length > 0) {
    input.db.transaction((tx) => {
      tx.insert(schema.activityEvents)
        .values(
          accepted.map((event) => ({
            id: `i_${randomUUID()}`,
            ts: event.ts,
            receivedAt: now.toISOString(),
            familyId: eventFamilies.get(event.gameId) ?? input.principal.familyId,
            gameId: event.gameId,
            jobId: event.jobId,
            aiurRunId: event.aiurRunId,
            attemptId: event.attemptId,
            actor: event.actor,
            activity: event.activity,
            boundary: event.boundary,
            source: event.source,
            metaJson: JSON.stringify(event.meta),
            principalKind: input.principal.kind,
            principalId: input.principal.kind === 'job' ? input.principal.jobId : input.principal.userId,
          })),
        )
        .run();
    });
  }

  const response = { accepted: accepted.length, rejected };
  input.log({
    event: 'analytics_ingest',
    accepted: response.accepted,
    rejected: response.rejected.length,
    principalKind: input.principal.kind,
  });
  return response;
}
