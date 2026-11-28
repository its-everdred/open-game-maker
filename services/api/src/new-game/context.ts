import { AgreedScope, ScopeChoices, type DesignDecision } from '@ogm/contracts';
import { schema, type Db, type Sqlite } from '@ogm/db';
import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';

import { jobAttachments, type AttachmentRow } from '../build-chat/attachments.js';
import { listSince, type ChatRow } from '../build-chat/store.js';
import { listDesignDecisions } from '../design-decisions/store.js';

// A New Game request's private context. The store is the app's own private storage — the jobs and scope-session rows,
// the append-only chat table (voice transcripts land there as text), the scope revision history and the blob store —
// keyed by the request's opaque reference. None of it is copied to GitHub; an authorised agent reads it here.
export type NewGameContext = {
  request: string;
  game: { id: string; title: string; slug: string | null };
  choices: ScopeChoices | null;
  brief: string;
  spec: AgreedScope | null;
  revisions: { revision: number; agreedAt: string }[];
  designDecisions: DesignDecision[];
  messages: {
    id: string;
    at: string;
    actor: ChatRow['actor'];
    kind: ChatRow['kind'];
    text: string | null;
    media: boolean;
  }[];
  attachments: {
    id: string;
    kind: AttachmentRow['kind'];
    name: string;
    mime: string;
    bytes: number;
    messageId: string | null;
  }[];
  parent: { repo: string; number: number } | null;
};

type RequestRow = typeof schema.jobs.$inferSelect;
type GameRow = typeof schema.games.$inferSelect;

const MESSAGE_LIMIT = 1_000;
const BRIEF_MAX = 2_000;

export function findRequest(db: Db, requestId: string): { job: RequestRow; game: GameRow } | null {
  const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, requestId)).get();
  // Only a filed New Game request has a parent issue to point an agent at; anything else is not a request.
  if (!job || job.kind !== 'new_game' || job.aiurIssueNumber === null) return null;
  const game = db.select().from(schema.games).where(eq(schema.games.id, job.gameId)).get();
  if (!game) return null;
  return { job, game };
}

export function newGameContext(db: Db, sqlite: Sqlite, requestId: string): NewGameContext | null {
  const found = findRequest(db, requestId);
  if (!found) return null;
  const { job, game } = found;
  const parent = db
    .select({ repo: schema.jobTickets.repo, number: schema.jobTickets.issueNumber })
    .from(schema.jobTickets)
    .where(and(eq(schema.jobTickets.jobId, job.id), eq(schema.jobTickets.key, 'new-game')))
    .get();
  const plan = json(job.plan);
  const session = latestAgreedSession(db, job);

  const messages: NewGameContext['messages'] = [];
  for (const chatJobId of new Set([session?.chatJobId, job.id].filter((id): id is string => typeof id === 'string'))) {
    let cursor = 0;
    for (;;) {
      const page = listSince(sqlite, chatJobId, cursor, MESSAGE_LIMIT);
      for (const row of page)
        messages.push({
          id: row.id,
          at: row.at,
          actor: row.actor,
          kind: row.kind,
          text: row.text,
          media: row.mediaHash !== null,
        });
      if (page.length < MESSAGE_LIMIT) break;
      cursor = page[page.length - 1]!.seq;
    }
  }
  messages.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0));

  const attachments = [
    ...(session === null ? [] : jobAttachments(sqlite, session.chatJobId)),
    ...jobAttachments(sqlite, job.id),
  ].map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    mime: row.mime,
    bytes: row.bytes,
    messageId: row.messageId,
  }));

  return {
    request: job.id,
    game: { id: game.id, title: game.title, slug: game.slug ?? null },
    choices: session === null ? null : session.choices,
    brief: typeof plan.summary === 'string' ? plan.summary.slice(0, BRIEF_MAX) : '',
    spec: session?.scope ?? null,
    revisions: session?.revisions ?? [],
    designDecisions: listDesignDecisions(db, game.id),
    messages,
    attachments,
    parent:
      parent ??
      (job.aiurRepo === null || job.aiurIssueNumber === null
        ? null
        : { repo: job.aiurRepo, number: job.aiurIssueNumber }),
  };
}

type FoundSession = {
  id: string;
  chatJobId: string;
  choices: ScopeChoices | null;
  scope: AgreedScope | null;
  revisions: NewGameContext['revisions'];
};

// The scope session the New Game flow finished: the game's latest agreed session created before the request, matched
// on the agreed title when one matches. Null when the session cannot be identified.
function latestAgreedSession(db: Db, job: RequestRow): FoundSession | null {
  const title = text(json(job.plan).title);
  const rows = db
    .select()
    .from(schema.scopeSessions)
    .where(
      and(
        eq(schema.scopeSessions.gameId, job.gameId),
        eq(schema.scopeSessions.status, 'agreed'),
        lte(schema.scopeSessions.createdAt, job.createdAt),
      ),
    )
    .orderBy(desc(schema.scopeSessions.createdAt))
    .all();
  const drafts = db
    .select()
    .from(schema.gameDrafts)
    .where(
      and(
        eq(schema.gameDrafts.gameId, job.gameId),
        inArray(schema.gameDrafts.status, ['agreed', 'promoted']),
        lte(schema.gameDrafts.createdAt, job.createdAt),
      ),
    )
    .orderBy(desc(schema.gameDrafts.createdAt))
    .all();
  const candidates = [
    ...rows.map((row) => ({
      id: row.id,
      chatJobId: row.jobId,
      choices: row.choices,
      scope: row.scope,
      createdAt: row.createdAt,
      revisions: revisionsFor(db, row.id),
    })),
    ...drafts.map((draft) => ({
      id: draft.id,
      chatJobId: `draft:${draft.id}`,
      choices: draft.choices,
      scope: draft.scope,
      createdAt: draft.createdAt,
      revisions: [{ revision: draft.revision, agreedAt: draft.updatedAt }],
    })),
  ].sort((left, right) => (left.createdAt > right.createdAt ? -1 : left.createdAt < right.createdAt ? 1 : 0));
  const chosen = candidates.find((row) => row.scope !== null && text(json(row.scope).title) === title) ?? candidates[0];
  if (!chosen) return null;
  const scope = chosen.scope === null ? null : AgreedScope.safeParse(json(chosen.scope));
  const choices = ScopeChoices.safeParse(json(chosen.choices));
  return {
    id: chosen.id,
    chatJobId: chosen.chatJobId,
    choices: choices.success ? choices.data : null,
    scope: scope?.success ? scope.data : null,
    revisions: chosen.revisions,
  };
}

/** The original creation conversation whose answers belong to this request. */
export function scopeChatJobForRequest(db: Db, job: RequestRow): string | null {
  return latestAgreedSession(db, job)?.chatJobId ?? null;
}

export function scopeChoicesForRequest(db: Db, job: RequestRow): ScopeChoices | null {
  return latestAgreedSession(db, job)?.choices ?? null;
}

function revisionsFor(db: Db, sessionId: string): NewGameContext['revisions'] {
  return db
    .select({ revision: schema.scopeSessionRevisions.revision, agreedAt: schema.scopeSessionRevisions.agreedAt })
    .from(schema.scopeSessionRevisions)
    .where(eq(schema.scopeSessionRevisions.sessionId, sessionId))
    .orderBy(asc(schema.scopeSessionRevisions.revision))
    .all();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

// A row's JSON column, read as an object: a hand-edited or half-written column degrades the context, never throws.
function json(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
