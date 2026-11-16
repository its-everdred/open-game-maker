import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';

// A verdict suppresses a missing-review report until the tracker observes the ticket leave review.
export function markReviewAnswered(db: Db, source: string, ticket: string): void {
  db.insert(schema.reviewAnswerGuards).values({ source, ticket }).onConflictDoNothing().run();
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
