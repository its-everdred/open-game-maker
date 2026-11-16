import { createHash, randomUUID } from 'node:crypto';
import type { AiurClient } from '@ogm/aiur-client';
import { tryRecordReview, type RecordReviewInput } from '../reviews/store.js';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';

// A verdict suppresses a missing-review report until the tracker observes the ticket leave review.
export function markReviewAnswered(db: Db, source: string, ticket: string, episode?: string | null): string {
  const value = episode ?? `unknown@${randomUUID()}`;
  db.insert(schema.reviewAnswerGuards)
    .values({ source, ticket, episode: value })
    .onConflictDoUpdate({
      target: [schema.reviewAnswerGuards.source, schema.reviewAnswerGuards.ticket],
      set: { episode: value, observedReview: false },
    })
    .run();
  return value;
}

// Every in-flight answer has its own durable guard, so completions cannot unguard each other.
export function beginReviewAnswer(
  db: Db,
  source: string,
  ticket: string,
  key?: string,
  intent?: { input: RecordReviewInput; principal: string; option?: string; response?: string },
): string {
  const digest = intent ? `:${createHash('sha256').update(JSON.stringify(intent)).digest('hex')}` : '';
  const id = key ? Buffer.from(`${key}${digest}`).toString('base64url') : randomUUID();
  const value = `pending@${id}`;
  db.insert(schema.reviewAnswerGuards)
    .values({ source, ticket: `${ticket}/${value}`, episode: intent ? JSON.stringify(intent) : value })
    .onConflictDoNothing()
    .run();
  return value;
}

export function discardReviewAnswer(db: Db, source: string, ticket: string, expected: string): void {
  db.delete(schema.reviewAnswerGuards)
    .where(
      and(eq(schema.reviewAnswerGuards.source, source), eq(schema.reviewAnswerGuards.ticket, `${ticket}/${expected}`)),
    )
    .run();
}

export function bindReviewEpisode(
  db: Db,
  source: string,
  ticket: string,
  expected: string,
  episode: string | null | undefined,
): void {
  if (expected.startsWith('pending@')) {
    db.transaction((tx) => {
      const pending = tx
        .select()
        .from(schema.reviewAnswerGuards)
        .where(
          and(
            eq(schema.reviewAnswerGuards.source, source),
            eq(schema.reviewAnswerGuards.ticket, `${ticket}/${expected}`),
          ),
        )
        .get();
      if (!pending) return;
      if (episode !== null) markReviewAnswered(tx, source, ticket, episode);
      discardReviewAnswer(tx, source, ticket, expected);
    });
    return;
  }
  if (episode === undefined) return;
  if (episode === null) {
    db.delete(schema.reviewAnswerGuards)
      .where(
        and(
          eq(schema.reviewAnswerGuards.source, source),
          eq(schema.reviewAnswerGuards.ticket, ticket),
          eq(schema.reviewAnswerGuards.episode, expected),
        ),
      )
      .run();
    return;
  }
  db.update(schema.reviewAnswerGuards)
    .set({ episode })
    .where(
      and(
        eq(schema.reviewAnswerGuards.source, source),
        eq(schema.reviewAnswerGuards.ticket, ticket),
        eq(schema.reviewAnswerGuards.episode, expected),
      ),
    )
    .run();
}

// Reconcile a lost response from the daemon without relying on the answered card still being visible.
export async function reconcilePendingCommands(
  db: Db,
  source: string,
  ticket: string,
  episode: string,
  client: AiurClient,
  log: (line: Record<string, unknown>) => void = () => {},
): Promise<void> {
  const prefix = `${ticket}/pending@`;
  const rows = db
    .select({ ticket: schema.reviewAnswerGuards.ticket, episode: schema.reviewAnswerGuards.episode })
    .from(schema.reviewAnswerGuards)
    .where(eq(schema.reviewAnswerGuards.source, source))
    .all();
  for (const row of rows) {
    if (!row.ticket.startsWith(prefix)) continue;
    const token = row.ticket.slice(ticket.length + 1);
    let key: string;
    try {
      key = Buffer.from(token.slice('pending@'.length), 'base64url').toString('utf8');
    } catch {
      continue;
    }
    const match = /^command:([^:]+):[1-9]\d*(?::[a-f0-9]{64})?$/.exec(key);
    if (!match) continue;
    const decision = await client.decision(match[1]).catch(() => null);
    const answer = decision?.active_answer ?? decision?.answer;
    if (decision && answer) {
      if (row.episode && row.episode !== token) {
        let intent: { input: RecordReviewInput; principal: string; option?: string; response?: string };
        try {
          intent = JSON.parse(row.episode);
        } catch {
          continue;
        }
        const actor = answer.actor as { kind?: string; id?: string } | undefined;
        const same =
          actor?.kind === 'operator' &&
          actor.id === intent.principal &&
          (intent.option
            ? (answer.option_id ?? answer.selected_option_id ?? answer.option) === intent.option
            : answer.custom_response === intent.response);
        if (same && !tryRecordReview(db, intent.input, log)) continue;
      }
      bindReviewEpisode(db, source, ticket, token, episode);
    } else if (decision && ['expired', 'dismissed', 'moot'].includes(decision.decision_status))
      discardReviewAnswer(db, source, ticket, token);
  }
}

export function reconcilePendingPreviews(
  db: Db,
  source: string,
  ticket: string,
  episode: string,
  answeredBuilds: ReadonlySet<string>,
): void {
  const prefix = `${ticket}/pending@`;
  const rows = db
    .select({ ticket: schema.reviewAnswerGuards.ticket })
    .from(schema.reviewAnswerGuards)
    .where(eq(schema.reviewAnswerGuards.source, source))
    .all();
  for (const row of rows) {
    if (!row.ticket.startsWith(prefix)) continue;
    const token = row.ticket.slice(ticket.length + 1);
    const key = Buffer.from(token.slice('pending@'.length), 'base64url').toString('utf8');
    if (key.startsWith('preview:') && answeredBuilds.has(key.slice('preview:'.length)))
      bindReviewEpisode(db, source, ticket, token, episode);
  }
}

export async function readReviewEpisode(
  reader:
    | ((repo: { owner: string; name: string }, ticket: string, labels: readonly string[]) => Promise<string | null>)
    | null,
  repo: { owner: string; name: string } | undefined,
  ticket: string,
  labels: readonly string[],
): Promise<string | null | undefined> {
  if (!reader || !repo) return undefined;
  try {
    return await reader(repo, ticket, labels);
  } catch {
    return undefined;
  }
}

export async function reconcileReviewEpisode(
  db: Db,
  source: string,
  ticket: string,
  episode: string | null | undefined,
): Promise<void> {
  if (episode === undefined) return;
  const guard = db
    .select()
    .from(schema.reviewAnswerGuards)
    .where(and(eq(schema.reviewAnswerGuards.source, source), eq(schema.reviewAnswerGuards.ticket, ticket)))
    .get();
  // Without an observed episode ID, wall-clock timestamps cannot establish event order.
  // Keep the guard until the tracker observes the ticket leave review.
  const changed = guard?.episode && !guard.episode.startsWith('unknown@') && guard.episode !== episode;
  if (changed)
    db.delete(schema.reviewAnswerGuards)
      .where(and(eq(schema.reviewAnswerGuards.source, source), eq(schema.reviewAnswerGuards.ticket, ticket)))
      .run();
}

export function reviewAnswerPending(db: Db, source: string, ticket: string): boolean {
  return db
    .select({ ticket: schema.reviewAnswerGuards.ticket })
    .from(schema.reviewAnswerGuards)
    .where(eq(schema.reviewAnswerGuards.source, source))
    .all()
    .some((row) => row.ticket === ticket || row.ticket.startsWith(`${ticket}/pending@`));
}
export function observeReviewState(db: Db, source: string, ticket: string, isReview: boolean): void {
  if (isReview) {
    db.update(schema.reviewAnswerGuards)
      .set({ observedReview: true })
      .where(and(eq(schema.reviewAnswerGuards.source, source), eq(schema.reviewAnswerGuards.ticket, ticket)))
      .run();
  } else {
    db.delete(schema.reviewAnswerGuards)
      .where(
        and(
          eq(schema.reviewAnswerGuards.source, source),
          eq(schema.reviewAnswerGuards.ticket, ticket),
          eq(schema.reviewAnswerGuards.observedReview, true),
        ),
      )
      .run();
  }
}
export function retainReviewTickets(db: Db, source: string, tickets: ReadonlySet<string>): void {
  const pending = db
    .select({ ticket: schema.reviewAnswerGuards.ticket })
    .from(schema.reviewAnswerGuards)
    .where(eq(schema.reviewAnswerGuards.source, source))
    .all();
  for (const { ticket } of pending) {
    if (ticket.includes('/pending@')) continue;
    observeReviewState(db, source, ticket, tickets.has(ticket));
  }
}
