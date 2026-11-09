import type { DesignDecision } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, asc, desc, eq } from 'drizzle-orm';

import type { LogLine } from '../app/types.js';

type DesignDecisionRow = typeof schema.designDecisions.$inferSelect;

// A design decision's id is the game's own sequence, so the first decision a game records is `D-01`. Two digits keep
// the ids in one order as plain text; a game that outgrows 99 decisions keeps counting in three.
export function decisionId(number: number): string {
  return `D-${String(number).padStart(2, '0')}`;
}

// A New Game design conversation runs in the creation chat's `scope` ticket and, once a request exists, on the
// `new_game` parent's own Commands. Commands answered elsewhere (an edit's feature ticket) are not design decisions.
export function isDesignJob(kind: string): boolean {
  return kind === 'new_game' || kind === 'scope';
}

export type RecordDesignDecisionInput = {
  gameId: string;
  jobId: string;
  ticket: string | null;
  commandId: string;
  decisionId: string;
  question: string;
  options: { id: string; label: string }[];
  recommended: string | null;
  chosen: string;
  origin: 'player' | 'default';
  skipped?: boolean;
  // The aiur tickets or design areas this decision changes, named in the Executor's notification.
  affects?: string[];
  at?: string;
};

export type RecordDesignDecisionResult = { decision: DesignDecision; created: boolean; changed: boolean };

// Records one answered design Command. Repeating the same answer for the same Command is a no-op, so a poller and an
// answer route that both see the same answer cannot record it twice; a different answer is a later decision that
// supersedes the earlier one. A provisional default is the authoritative attribution for the choice it shares with an
// earlier row, because a poller can see the defaulted Command before the sweep records its own default.
export function recordDesignDecision(db: Db, input: RecordDesignDecisionInput): RecordDesignDecisionResult {
  return db.transaction((tx) => {
    // Every read runs through the same transaction as the write, so the sequence a row takes cannot race another writer.
    const previous = previousRow(tx, input.gameId, input.commandId);
    if (previous !== null && previous.chosen === input.chosen) {
      const promote = input.origin === 'default' && previous.origin !== 'default';
      const markSkipped = input.skipped === true && !previous.skipped;
      const decision = toDecision(previous);
      if (!promote && !markSkipped) return { decision, created: false, changed: false };
      const patched = {
        ...decision,
        ...(promote ? { origin: 'default' as const } : {}),
        ...(markSkipped ? { skipped: true } : {}),
      };
      tx.update(schema.designDecisions)
        .set({ origin: patched.origin, skipped: patched.skipped })
        .where(and(eq(schema.designDecisions.gameId, input.gameId), eq(schema.designDecisions.number, previous.number)))
        .run();
      return { decision: patched, created: false, changed: true };
    }

    const row: DesignDecisionRow = {
      gameId: input.gameId,
      number: nextNumber(tx, input.gameId),
      jobId: input.jobId,
      ticket: input.ticket,
      commandId: input.commandId,
      decisionId: input.decisionId,
      question: input.question,
      options: JSON.stringify(input.options),
      recommended: input.recommended,
      chosen: input.chosen,
      origin: input.origin,
      skipped: input.skipped === true,
      affects: JSON.stringify(input.affects ?? (input.ticket === null ? [] : [input.ticket])),
      supersedes: previous?.number ?? null,
      at: input.at ?? new Date().toISOString(),
    };
    tx.insert(schema.designDecisions).values(row).run();
    return { decision: toDecision(row), created: true, changed: true };
  });
}

// The history is derived data: an answer the Command already took must not fail because recording it did. A writer that
// cannot record logs the failure for the operator and carries on, and the caller skips the Executor's notification
// rather than naming a decision id that does not exist. The aiur answer and the inbox write have already happened by
// the time this runs, so failing the request would show the player an error for an answer aiur has taken.
export function tryRecordDesignDecision(
  db: Db,
  input: RecordDesignDecisionInput,
  log: (line: LogLine) => void,
): RecordDesignDecisionResult | null {
  try {
    return recordDesignDecision(db, input);
  } catch (error) {
    log({
      event: 'design-decision-record-error',
      gameId: input.gameId,
      jobId: input.jobId,
      commandId: input.commandId,
      error: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}

// The game's history, oldest first. A later answer is appended after the decision it supersedes, so reading in order
// shows what stands now at the end of each question's chain.
export function listDesignDecisions(db: Db, gameId: string): DesignDecision[] {
  return db
    .select()
    .from(schema.designDecisions)
    .where(eq(schema.designDecisions.gameId, gameId))
    .orderBy(asc(schema.designDecisions.number))
    .all()
    .map(toDecision);
}

export function latestForCommand(db: Db, gameId: string, commandId: string): DesignDecision | null {
  const row = previousRow(db, gameId, commandId);
  return row === null ? null : toDecision(row);
}

// The row behind the newest decision for a Command: a later answer needs its sequence to name what it supersedes. Both
// helpers read through whatever handle the caller holds, so a transaction's reads stay inside it.
type DecisionReads = Pick<Db, 'select'>;

function previousRow(db: DecisionReads, gameId: string, commandId: string): DesignDecisionRow | null {
  const row = db
    .select()
    .from(schema.designDecisions)
    .where(and(eq(schema.designDecisions.gameId, gameId), eq(schema.designDecisions.commandId, commandId)))
    .orderBy(desc(schema.designDecisions.number))
    .get();
  return row ?? null;
}

function nextNumber(db: DecisionReads, gameId: string): number {
  const row = db
    .select({ number: schema.designDecisions.number })
    .from(schema.designDecisions)
    .where(eq(schema.designDecisions.gameId, gameId))
    .orderBy(desc(schema.designDecisions.number))
    .get();
  return (row?.number ?? 0) + 1;
}

function toDecision(row: DesignDecisionRow): DesignDecision {
  return {
    id: decisionId(row.number),
    game_id: row.gameId,
    job_id: row.jobId,
    ticket: row.ticket,
    command_id: row.commandId,
    decision_id: row.decisionId,
    question: row.question,
    options: JSON.parse(row.options) as DesignDecision['options'],
    recommended: row.recommended,
    chosen: row.chosen,
    origin: row.origin,
    skipped: row.skipped,
    affects: JSON.parse(row.affects) as string[],
    supersedes: row.supersedes === null ? null : decisionId(row.supersedes),
    at: row.at,
  };
}
