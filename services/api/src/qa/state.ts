import { eq } from 'drizzle-orm';
import type { Decision, TicketDetail } from '@ogm/aiur-client';
import { schema, type Db } from '@ogm/db';

// The QA creator account (#859): one dedicated user, in a family of its own, owning one private game. Its ids, the
// Commands a review E2E seeded and what reached its aiur boundary live in one `app_meta` row, so the boundary needs no
// table of its own and a restart keeps them.
export const QA_STATE_KEY = 'qa:review';

// The aiur ticket every QA round and Command belongs to. The QA game has no aiur instance, so nothing dispatches it.
export const QA_TICKET = 'qa-review';

// What reached the QA game's aiur boundary: a Command answer or a round's rework, exactly as the real client gets it.
export type QaReceived =
  | { kind: 'answer'; at: string; ticket: string; decisionId: string; option?: string; response?: string }
  | { kind: 'rework'; at: string; ticket: string; key: string; reason: string };

export type QaState = {
  userId: string;
  email: string;
  familyId: string;
  gameId: string;
  decisions: Decision[];
  received: QaReceived[];
  // Ticket details a ticket-detail E2E seeded (#873): open ones list as the game's builds, closed ones as completed.
  tickets?: TicketDetail[];
  voiceDraftId?: string;
  voiceDraftRun?: string;
};

export function readQaState(db: Db): QaState | null {
  const row = db
    .select({ value: schema.appMeta.value })
    .from(schema.appMeta)
    .where(eq(schema.appMeta.key, QA_STATE_KEY))
    .get();
  return row ? (JSON.parse(row.value) as QaState) : null;
}

export function writeQaState(db: Db, state: QaState): void {
  const value = JSON.stringify(state);
  db.insert(schema.appMeta)
    .values({ key: QA_STATE_KEY, value })
    .onConflictDoUpdate({ target: schema.appMeta.key, set: { value } })
    .run();
}

export function updateQaState(db: Db, change: (state: QaState) => void): QaState {
  return db.transaction((tx) => {
    const state = readQaState(tx);
    if (!state) throw new Error('qa_account_missing');
    change(state);
    writeQaState(tx, state);
    return state;
  });
}

export function isQaGame(db: Db, gameId: string): boolean {
  return readQaState(db)?.gameId === gameId;
}
