import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { ReviewSubmission } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';

export type ReviewRound = typeof schema.reviewRounds.$inferSelect;
export type NewReviewRound = typeof schema.reviewRounds.$inferInsert;
export type Verdict = NonNullable<ReviewRound['verdict']>;
export type VerdictSource = NonNullable<ReviewRound['verdictSource']>;

// Insertion is append-only: a phase/round identity cannot silently replace an earlier submission.
export function postRound(db: Db, round: NewReviewRound): void {
  db.insert(schema.reviewRounds).values(round).run();
}

export function getRound(db: Db, gameId: string, id: string): ReviewRound | undefined {
  return db
    .select()
    .from(schema.reviewRounds)
    .where(and(eq(schema.reviewRounds.gameId, gameId), eq(schema.reviewRounds.id, id)))
    .get();
}

// A retry of the same answer is harmless; a different answer cannot overwrite history.
export function answerRound(
  db: Db,
  gameId: string,
  id: string,
  answer: { verdict: Verdict; notes: string | null; source: VerdictSource; at: string },
): boolean {
  const changed = db
    .update(schema.reviewRounds)
    .set({
      verdict: answer.verdict,
      notes: answer.notes,
      verdictSource: answer.source,
      verdictAt: answer.at,
    })
    .where(
      and(eq(schema.reviewRounds.gameId, gameId), eq(schema.reviewRounds.id, id), isNull(schema.reviewRounds.verdict)),
    )
    .run();
  if (changed.changes === 1) return true;
  const existing = getRound(db, gameId, id);
  return (
    existing !== undefined &&
    existing.verdict === answer.verdict &&
    existing.notes === answer.notes &&
    existing.verdictSource === answer.source
  );
}

export function consumeRound(db: Db, gameId: string, id: string, run: string, at: string): boolean {
  const changed = db
    .update(schema.reviewRounds)
    .set({ consumedByRun: run, consumedAt: at })
    .where(
      and(
        eq(schema.reviewRounds.gameId, gameId),
        eq(schema.reviewRounds.id, id),
        isNull(schema.reviewRounds.consumedByRun),
        isNotNull(schema.reviewRounds.verdict),
      ),
    )
    .run();
  return changed.changes === 1;
}

// Allocate the sequence and insert under one SQLite transaction.
export function submitRound(db: Db, gameId: string, submission: ReviewSubmission): ReviewRound {
  return db.transaction((tx) => {
    const existing = tx.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.id, submission.id)).get();
    if (existing) {
      const matches =
        existing.gameId === gameId &&
        existing.track === submission.track &&
        existing.phase === submission.phase &&
        existing.category === submission.category &&
        existing.ticket === submission.ticket &&
        existing.sha === submission.sha &&
        existing.prNumber === (submission.prNumber ?? null) &&
        existing.question === (submission.question ?? null) &&
        existing.media === JSON.stringify(submission.media);
      if (!matches) throw new Error('review_submission_conflict');
      return existing;
    }
    for (const media of submission.media) {
      if (media.kind !== 'build') continue;
      const used = tx
        .select({ id: schema.reviewRounds.id })
        .from(schema.reviewRounds)
        .where(
          and(
            eq(schema.reviewRounds.gameId, gameId),
            sql`EXISTS (SELECT 1 FROM json_each(${schema.reviewRounds.media}) WHERE json_extract(value, '$.kind') = 'build' AND json_extract(value, '$.ref') = ${media.ref})`,
          ),
        )
        .get();
      if (used) throw new Error('review_build_already_used');
    }
    const latest = tx
      .select({ round: schema.reviewRounds.round, verdict: schema.reviewRounds.verdict })
      .from(schema.reviewRounds)
      .where(
        and(
          eq(schema.reviewRounds.gameId, gameId),
          eq(schema.reviewRounds.track, submission.track),
          eq(schema.reviewRounds.phase, submission.phase),
        ),
      )
      .orderBy(desc(schema.reviewRounds.round))
      .get();
    if (latest && latest.verdict !== 'needs_work') throw new Error('review_phase_not_ready');
    const row: NewReviewRound = {
      id: submission.id,
      gameId,
      track: submission.track,
      phase: submission.phase,
      category: submission.category,
      round: (latest?.round ?? 0) + 1,
      ticket: submission.ticket,
      sha: submission.sha,
      prNumber: submission.prNumber ?? null,
      media: JSON.stringify(submission.media),
      question: submission.question ?? null,
      postedAt: new Date().toISOString(),
    };
    tx.insert(schema.reviewRounds).values(row).run();
    return tx.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.id, row.id)).get()!;
  });
}

// Locate the specific posted build, never a newer round for the same ticket.
export function roundForBuild(db: Db, gameId: string, ticket: string, buildId: string): ReviewRound | undefined {
  return db
    .select()
    .from(schema.reviewRounds)
    .where(
      and(
        eq(schema.reviewRounds.gameId, gameId),
        eq(schema.reviewRounds.ticket, ticket),
        sql`EXISTS (SELECT 1 FROM json_each(${schema.reviewRounds.media}) WHERE json_extract(value, '$.kind') = 'build' AND json_extract(value, '$.ref') = ${buildId})`,
      ),
    )
    .get();
}

// A digest acknowledges delivery once; acknowledgement never invents a verdict.
export function markReminded(db: Db, id: string, at: string): boolean {
  const result = db
    .update(schema.reviewRounds)
    .set({ remindedAt: at })
    .where(
      and(
        eq(schema.reviewRounds.id, id),
        isNull(schema.reviewRounds.verdict),
        isNull(schema.reviewRounds.remindedAt),
        sql`julianday(${schema.reviewRounds.postedAt}) <= julianday(${at}) - 1`,
      ),
    )
    .run();
  return result.changes === 1;
}
