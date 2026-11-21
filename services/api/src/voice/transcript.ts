import { createHash } from 'node:crypto';

import type { VoiceTarget, VoiceTranscriptRequest, VoiceTranscriptResponse } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { and, desc, eq } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import { getChatRuntime } from '../build-chat/routes.js';
import { insertChatRow } from '../build-chat/store.js';
import { scopeSessions } from '../scope/store.js';
import { gameDrafts } from '../new-game/drafts.js';
import { targetKey } from './briefing-push.js';
import { jobFor } from './briefing-push.js';
import { deliverInstruction } from './instruct.js';

function stableUuid(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function buildJob(deps: AppDeps, target: Extract<VoiceTarget, { kind: 'build' }>): string | null {
  const job = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, target.job_id)).get();
  return job &&
    job.gameId === target.game_id &&
    job.creatorId === target.creator_id &&
    job.aiurIssueNumber !== null &&
    String(job.aiurIssueNumber) === target.ticket
    ? job.id
    : null;
}

function scopeJob(deps: AppDeps, target: Extract<VoiceTarget, { kind: 'scope' }>): string | null {
  const session = scopeSessions.get(deps.db, target.session_id);
  if (session?.game_id === target.game_id && session.creator_id === target.creator_id) return session.job_id;
  const draft = gameDrafts.get(deps.db, target.session_id);
  return draft &&
    draft.id === target.game_id &&
    draft.creatorId === target.creator_id &&
    ['open', 'agreed'].includes(draft.status)
    ? `draft:${draft.id}`
    : null;
}

// A question session belongs to the game, so its words go to the creator's newest build chat in that game.
function questionsJob(deps: AppDeps, target: Extract<VoiceTarget, { kind: 'questions' }>): string | null {
  const job = deps.db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.gameId, target.game_id), eq(schema.jobs.creatorId, target.creator_id)))
    .orderBy(desc(schema.jobs.createdAt))
    .get();
  return job?.id ?? null;
}

function targetJob(deps: AppDeps, target: VoiceTarget): string | null {
  if (target.kind === 'questions') return questionsJob(deps, target);
  if (target.kind === 'edit') return jobFor(deps.db, target)?.id ?? null;
  return target.kind === 'build' ? buildJob(deps, target) : scopeJob(deps, target);
}

export async function appendVoiceTranscript(
  deps: AppDeps,
  request: VoiceTranscriptRequest,
): Promise<VoiceTranscriptResponse | null> {
  if (request.target.kind === 'edit' && request.actor === 'creator' && !jobFor(deps.db, request.target)) {
    const result = await deliverInstruction(deps, {
      target: request.target,
      text: request.text.slice(0, 4000),
      idempotency_key: `opening:${request.conversation_id}`,
      kind: 'instruct',
    });
    if (result.status === 'failed' || result.status === 'needs_choice') return null;
  }
  const jobId = targetJob(deps, request.target);
  if (jobId === null) return null;

  const identity = JSON.stringify([targetKey(request.target), request.conversation_id, request.actor, request.turn_id]);
  const id = `m_${stableUuid(identity)}`;
  const { row, inserted } = insertChatRow(deps.sqlite, {
    id,
    jobId,
    actor: request.actor,
    kind: 'text',
    text: request.text,
  });
  if (inserted) getChatRuntime(deps).hub.publish(jobId);
  return { message_id: row!.id, inserted };
}
