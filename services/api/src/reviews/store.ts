import { randomUUID } from 'node:crypto';

import type { CommandReviewEntry, CommandReview as CommandReviewValue, GameCommand } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, desc, eq } from 'drizzle-orm';

import type { LogLine } from '../app/types.js';
import { listJobs } from '../jobs/repo.js';

type CommandReviewRow = typeof schema.commandReviews.$inferSelect;

export type RecordReviewInput = {
  gameId: string;
  command: GameCommand;
  optionId: string;
  review: CommandReviewValue;
  at?: string;
};

// A review answer lands in the game's ledger beside the decision it answered. Repeating the same answer for the same
// Command records nothing, so a retried request cannot write the creator's reasons twice.
export function recordReview(db: Db, input: RecordReviewInput): CommandReviewEntry | null {
  const likes = cards(input.command, input.review.likes);
  const dislikes = input.review.dislikes.map(({ option_id: id, reason }) => ({
    ...card(input.command, id),
    reason: reason ?? null,
  }));
  const notes = input.review.notes ?? null;
  const existing = db
    .select()
    .from(schema.commandReviews)
    .where(
      and(
        eq(schema.commandReviews.gameId, input.gameId),
        eq(schema.commandReviews.checkpointId, input.command.checkpoint_id),
      ),
    )
    .orderBy(desc(schema.commandReviews.at))
    .get();
  if (existing !== undefined && sameReview(existing, input.optionId, likes, dislikes, notes)) return toEntry(existing);

  const row: CommandReviewRow = {
    id: reviewId(),
    gameId: input.gameId,
    jobId: input.command.job_id,
    ticket: input.command.ticket,
    title: input.command.title,
    checkpointId: input.command.checkpoint_id,
    decisionId: input.command.decision_id,
    question: input.command.question,
    optionId: input.optionId,
    likes: JSON.stringify(likes),
    dislikes: JSON.stringify(dislikes),
    notes,
    at: input.at ?? new Date().toISOString(),
  };
  db.insert(schema.commandReviews).values(row).run();
  return toEntry(row);
}

// A review the answer route already took must not fail because the ledger write did: the aiur decision is answered and
// the inbox row is written by then. The writer logs and carries on, and the response still says the answer landed.
export function tryRecordReview(
  db: Db,
  input: RecordReviewInput,
  log: (line: LogLine) => void,
): CommandReviewEntry | null {
  try {
    return recordReview(db, input);
  } catch (error) {
    log({
      event: 'command-review-record-error',
      gameId: input.gameId,
      jobId: input.command.job_id,
      checkpointId: input.command.checkpoint_id,
      error: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}

// The game's review ledger, newest first — the read #567 builds the game's design/feedback.json from.
export function listReviews(db: Db, gameId: string): CommandReviewEntry[] {
  return db
    .select()
    .from(schema.commandReviews)
    .where(eq(schema.commandReviews.gameId, gameId))
    .orderBy(desc(schema.commandReviews.at), desc(schema.commandReviews.id))
    .all()
    .map(toEntry);
}

function card(command: GameCommand, id: string) {
  const option = command.options.find(({ id: candidate }) => candidate === id);
  if (option === undefined) throw new Error(`review card ${id} is not an option of Command ${command.checkpoint_id}`);
  return { option_id: option.id, label: option.label };
}

function cards(command: GameCommand, ids: readonly string[]) {
  return ids.map((id) => card(command, id));
}

function sameReview(
  row: CommandReviewRow,
  optionId: string,
  likes: unknown,
  dislikes: unknown,
  notes: string | null,
): boolean {
  return (
    row.optionId === optionId &&
    row.likes === JSON.stringify(likes) &&
    row.dislikes === JSON.stringify(dislikes) &&
    row.notes === notes
  );
}

// The Command's title is its job's plan title, the same one the Commands inbox shows.
export function jobTitle(db: Db, gameId: string, jobId: string): string {
  return listJobs(db, gameId).find((job) => job.id === jobId)?.plan.title ?? '';
}

// `<r_>` + uuid v4, the Id contract's prefix for a review row.
function reviewId(): string {
  return `r_${randomUUID()}`;
}

function toEntry(row: CommandReviewRow): CommandReviewEntry {
  return {
    id: row.id,
    game_id: row.gameId,
    job_id: row.jobId,
    ticket: row.ticket,
    title: row.title,
    checkpoint_id: row.checkpointId,
    decision_id: row.decisionId,
    question: row.question,
    option_id: row.optionId,
    likes: JSON.parse(row.likes) as CommandReviewEntry['likes'],
    dislikes: JSON.parse(row.dislikes) as CommandReviewEntry['dislikes'],
    notes: row.notes,
    at: row.at,
  };
}
