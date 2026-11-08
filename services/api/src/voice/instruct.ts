import { createHash } from 'node:crypto';

import type { InstructRequest, InstructResponse, VoiceTarget } from '@ogm/contracts';
import { schema } from '@ogm/db';
import type { Actor } from '@ogm/policy';
import { and, eq } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import { getChatRuntime } from '../build-chat/routes.js';
import { getChatRow, insertChatRow } from '../build-chat/store.js';
import { AdmissionRefused, admit } from '../jobs/admission.js';
import { clearVoiceWaitingOn, localTime, setVoiceWaitingOn, targetKey } from './briefing-push.js';

type Delivery = { promise: Promise<InstructResponse>; expiresAt: number };

const DELIVERY_TTL_MS = 10 * 60_000;
const deliveries = new WeakMap<AppDeps, Map<string, Delivery>>();

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableUuid(value: string): string {
  const digest = hash(value);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function receiptFor(target: VoiceTarget, idempotencyKey: string): string {
  return `voice_${hash(`${targetKey(target)}:${idempotencyKey}`).slice(0, 32)}`;
}

function admissionKey(idempotencyKey: string): string {
  const key = `voice:${idempotencyKey}`;
  return key.length <= 200 ? key : `voice:${hash(idempotencyKey)}`;
}

function scopeText(text: string): { text: string; later: boolean } {
  const later = /^\s*\[later\]\s*/i.test(text);
  return { text: text.replace(/^\s*\[later\]\s*/i, '').trim(), later };
}

async function deliverBuild(deps: AppDeps, request: InstructRequest): Promise<'delivered'> {
  const target = request.target;
  if (target.kind !== 'build') throw new Error('not a build target');
  const row = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, target.job_id)).get();
  if (
    !row ||
    row.gameId !== target.game_id ||
    row.creatorId !== target.creator_id ||
    row.aiurRepo === null ||
    row.aiurIssueNumber === null ||
    String(row.aiurIssueNumber) !== target.ticket
  ) {
    throw new Error('voice build target does not match a filed job');
  }

  const chatId = `m_${stableUuid(`${targetKey(target)}:${request.idempotency_key}`)}`;
  if (getChatRow(deps.sqlite, chatId)) return 'delivered';

  const aiur = await deps.aiurClientForGame(row.gameId);
  await aiur.message(target.ticket, request.text, request.idempotency_key);
  const { inserted } = insertChatRow(deps.sqlite, {
    id: chatId,
    jobId: row.id,
    actor: 'creator',
    kind: 'text',
    text: request.text,
    aiur: { ticket: target.ticket },
    mirrorState: 'sent',
  });
  if (inserted) getChatRuntime(deps).hub.publish(row.id);
  clearVoiceWaitingOn(target);
  return 'delivered';
}

async function deliverScope(
  deps: AppDeps,
  request: InstructRequest,
): Promise<'delivered' | 'queued_at_reset' | 'needs_choice'> {
  const target = request.target;
  if (target.kind !== 'scope') throw new Error('not a scope target');
  const draft = scopeText(request.text);
  if (!draft.text) throw new Error('empty voice draft');
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, target.game_id)).get();
  const membership = game
    ? deps.db
        .select()
        .from(schema.familyMembers)
        .where(
          and(eq(schema.familyMembers.familyId, game.familyId), eq(schema.familyMembers.userId, target.creator_id)),
        )
        .get()
    : undefined;
  if (!game || !membership) throw new Error('voice scope target is unavailable');
  const actor: Actor = {
    userId: target.creator_id,
    familyId: game.familyId,
    platformRole: 'none',
    capability: membership.capability,
  };
  const title =
    draft.text
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 120) ?? 'Voice request';

  try {
    const admitted = await admit(
      {
        db: deps.db,
        sqlite: deps.sqlite,
        events: deps.events,
        defaults: {
          dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
          resetZone: deps.config.resetZoneDefault,
        },
      },
      {
        gameId: game.id,
        branchId: 'main',
        kind: 'feature',
        complexity: 2,
        plan: {
          title,
          summary: draft.text,
          scope: { included: [], excluded: [] },
          tickets: [
            {
              key: 'voice',
              skills: [],
              dependsOn: [],
              acceptanceCriteria: [draft.text],
            },
          ],
        },
        start: draft.later ? 'at_reset' : 'now',
        idempotencyKey: admissionKey(request.idempotency_key),
      },
      actor,
    );
    clearVoiceWaitingOn(target);
    return draft.later && admitted.state === 'queued' ? 'queued_at_reset' : 'delivered';
  } catch (error) {
    if (!(error instanceof AdmissionRefused)) throw error;
    const reset = localTime(error.body.resetsAt, deps.config.resetZoneDefault);
    setVoiceWaitingOn(target, refusalText(error.body, reset));
    return 'needs_choice';
  }
}

const ENERGY_WINDOWS = { day: 'today', week: 'this week', month: 'this month' } as const;

// An Energy block names its window and only the offers admission made (#598); the member allowance keeps its wording.
function refusalText(body: AdmissionRefused['body'], reset: string): string {
  if (body.error !== 'energy_limit_reached')
    return `Doesn't fit today: trim, split, queue for ${reset}, or ask an admin`;
  const left = `Needs more Energy than is left ${ENERGY_WINDOWS[body.window ?? 'day']}`;
  return body.offers.includes('queue') ? `${left}: queue for ${reset}, or ask an admin` : `${left}: ask an admin`;
}

async function attempt(deps: AppDeps, request: InstructRequest): Promise<InstructResponse> {
  const delivery_id = receiptFor(request.target, request.idempotency_key);
  try {
    const status =
      request.target.kind === 'build' ? await deliverBuild(deps, request) : await deliverScope(deps, request);
    return { delivery_id, status };
  } catch (error) {
    deps.log({
      event: 'voice-instruct-failed',
      target_key: targetKey(request.target),
      error: error instanceof Error ? error.name : 'unknown',
    });
    return { delivery_id, status: 'failed' };
  }
}

export async function deliverInstruction(deps: AppDeps, request: InstructRequest): Promise<InstructResponse> {
  let cache = deliveries.get(deps);
  if (!cache) {
    cache = new Map();
    deliveries.set(deps, cache);
  }
  const now = Date.now();
  for (const [cachedKey, cached] of cache) {
    if (cached.expiresAt <= now) cache.delete(cachedKey);
  }
  const key = `${targetKey(request.target)}:${request.idempotency_key}`;
  const existing = cache.get(key);
  if (existing) return existing.promise;

  const delivery = { promise: attempt(deps, request), expiresAt: now + DELIVERY_TTL_MS };
  cache.set(key, delivery);
  const result = await delivery.promise;
  if (result.status === 'failed' && cache.get(key) === delivery) cache.delete(key);
  return result;
}
