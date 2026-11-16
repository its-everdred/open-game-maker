import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';

// A verdict suppresses a missing-review report until the tracker observes the ticket leave review.
export function markReviewAnswered(db: Db, source: string, ticket: string, episode?: string | null): void {
  db.insert(schema.reviewAnswerGuards)
    .values({ source, ticket, episode: episode ?? `unknown@${new Date().toISOString()}` })
    .onConflictDoUpdate({
      target: [schema.reviewAnswerGuards.source, schema.reviewAnswerGuards.ticket],
      set: { episode: episode ?? `unknown@${new Date().toISOString()}`, observedReview: false },
    })
    .run();
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
  const unknown = guard?.episode?.startsWith('unknown@') ? Date.parse(guard.episode.slice(8)) : null;
  const eventAt = episode?.includes('@') ? Date.parse(episode.slice(episode.indexOf('@') + 1)) : NaN;
  const changed =
    unknown === null
      ? guard?.episode && guard.episode !== episode
      : episode === null || (Number.isFinite(eventAt) && eventAt > unknown);
  if (changed)
    db.delete(schema.reviewAnswerGuards)
      .where(and(eq(schema.reviewAnswerGuards.source, source), eq(schema.reviewAnswerGuards.ticket, ticket)))
      .run();
}

export function reviewAnswerPending(db: Db, source: string, ticket: string): boolean {
  return (
    db
      .select({ ticket: schema.reviewAnswerGuards.ticket })
      .from(schema.reviewAnswerGuards)
      .where(and(eq(schema.reviewAnswerGuards.source, source), eq(schema.reviewAnswerGuards.ticket, ticket)))
      .get() !== undefined
  );
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
  for (const { ticket } of pending) observeReviewState(db, source, ticket, tickets.has(ticket));
}
