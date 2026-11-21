import { createHash, randomUUID } from 'node:crypto';

import {
  AgreedScope,
  ScopeChoices,
  type AgreedScope as AgreedScopeType,
  type ScopeChoices as ScopeChoicesType,
} from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type GameDraft = typeof schema.gameDrafts.$inferSelect;

export const gameDrafts = {
  create(
    db: Db,
    input: {
      familyId: string;
      creatorId: string;
      choices: ScopeChoicesType;
      allowAiGeneratedAssets: boolean;
      at?: Date;
    },
  ): GameDraft {
    const at = input.at ?? new Date();
    const id = `d_${randomUUID()}`;
    db.insert(schema.gameDrafts)
      .values({
        id,
        familyId: input.familyId,
        creatorId: input.creatorId,
        choices: JSON.stringify(ScopeChoices.parse(input.choices)),
        allowAiGeneratedAssets: input.allowAiGeneratedAssets,
        status: 'open',
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + DRAFT_TTL_MS).toISOString(),
      })
      .run();
    return gameDrafts.get(db, id)!;
  },

  get(db: Db, id: string): GameDraft | null {
    return db.select().from(schema.gameDrafts).where(eq(schema.gameDrafts.id, id)).get() ?? null;
  },

  attachTicket(db: Db, id: string, repo: string, number: number | null, at = new Date().toISOString()): boolean {
    return (
      db
        .update(schema.gameDrafts)
        .set({ ticketRepo: repo, ticketNumber: number, updatedAt: at })
        .where(and(eq(schema.gameDrafts.id, id), eq(schema.gameDrafts.status, 'open')))
        .run().changes > 0
    );
  },

  agree(db: Db, id: string, payload: unknown, at = new Date().toISOString()): AgreedScopeType | null {
    const scope = AgreedScope.parse(payload);
    const row = gameDrafts.get(db, id);
    if (!row || row.status !== 'open' || scope.session_id !== id || scope.revision !== row.revision + 1) return null;
    const encoded = JSON.stringify(scope);
    const scopeHash = createHash('sha256').update(encoded).digest('hex');
    const changed = db
      .update(schema.gameDrafts)
      .set({ status: 'agreed', revision: scope.revision, scope: encoded, scopeHash, updatedAt: at })
      .where(
        and(
          eq(schema.gameDrafts.id, id),
          eq(schema.gameDrafts.status, 'open'),
          eq(schema.gameDrafts.revision, row.revision),
        ),
      )
      .run().changes;
    return changed === 1 ? scope : null;
  },

  promote(db: Db, id: string, gameId: string, at = new Date().toISOString()): boolean {
    return (
      db
        .update(schema.gameDrafts)
        .set({ status: 'promoted', gameId, updatedAt: at })
        .where(and(eq(schema.gameDrafts.id, id), eq(schema.gameDrafts.status, 'agreed')))
        .run().changes > 0
    );
  },

  complete(db: Db, id: string, at = new Date().toISOString()): boolean {
    return (
      db
        .update(schema.gameDrafts)
        .set({ status: 'promoted', updatedAt: at })
        .where(and(eq(schema.gameDrafts.id, id), eq(schema.gameDrafts.status, 'agreed'), isNotNull(schema.gameDrafts.gameId)))
        .run().changes > 0
    );
  },

  attachGame(db: Db, id: string, gameId: string, at = new Date().toISOString()): boolean {
    return (
      db
        .update(schema.gameDrafts)
        .set({ gameId, updatedAt: at })
        .where(
          and(eq(schema.gameDrafts.id, id), eq(schema.gameDrafts.status, 'agreed'), isNull(schema.gameDrafts.gameId)),
        )
        .run().changes > 0
    );
  },

  delete(db: Db, id: string): boolean {
    return db.delete(schema.gameDrafts).where(eq(schema.gameDrafts.id, id)).run().changes > 0;
  },

  deleteUnfinished(db: Db, id: string): boolean {
    return (
      db
        .delete(schema.gameDrafts)
        .where(
          and(
            eq(schema.gameDrafts.id, id),
            inArray(schema.gameDrafts.status, ['open', 'agreed']),
            isNull(schema.gameDrafts.gameId),
          ),
        )
        .run().changes > 0
    );
  },

  expired(db: Db, now = new Date()): GameDraft[] {
    return db
      .select()
      .from(schema.gameDrafts)
      .where(
        and(
          lte(schema.gameDrafts.expiresAt, now.toISOString()),
          or(
            and(inArray(schema.gameDrafts.status, ['open', 'agreed']), isNull(schema.gameDrafts.gameId)),
            and(
              inArray(schema.gameDrafts.status, ['agreed', 'promoted']),
              isNotNull(schema.gameDrafts.gameId),
              isNotNull(schema.gameDrafts.ticketRepo),
            ),
          ),
        ),
      )
      .all();
  },

  clearTicket(db: Db, id: string, at = new Date().toISOString()): boolean {
    return (
      db
        .update(schema.gameDrafts)
        .set({ ticketRepo: null, ticketNumber: null, updatedAt: at })
        .where(
          and(
            eq(schema.gameDrafts.id, id),
            inArray(schema.gameDrafts.status, ['agreed', 'promoted']),
            isNotNull(schema.gameDrafts.gameId),
          ),
        )
        .run().changes > 0
    );
  },
};
