import { ReviewDraftDeck, type ReviewDraftsPage } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, eq } from 'drizzle-orm';

// A creator's review-deck votes as they cast them (#631). One row per creator, game and question; each save replaces
// the deck, so the latest vote, undo or reason is what a reload or another device sees.
export function saveDraft(
  db: Db,
  gameId: string,
  userId: string,
  key: string,
  deck: ReviewDraftDeck,
  at: string,
): void {
  const row = { gameId, userId, draftKey: key, deck: JSON.stringify(deck), updatedAt: at };
  db.insert(schema.reviewDrafts)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.reviewDrafts.gameId, schema.reviewDrafts.userId, schema.reviewDrafts.draftKey],
      set: { deck: row.deck, updatedAt: at },
    })
    .run();
}

// The creator's own drafts for the game. A row that no longer reads as a deck is left out rather than failing the page.
export function listDrafts(db: Db, gameId: string, userId: string): ReviewDraftsPage['drafts'] {
  return db
    .select()
    .from(schema.reviewDrafts)
    .where(and(eq(schema.reviewDrafts.gameId, gameId), eq(schema.reviewDrafts.userId, userId)))
    .all()
    .flatMap((row) => {
      const deck = ReviewDraftDeck.safeParse(JSON.parse(row.deck));
      return deck.success ? [{ key: row.draftKey, deck: deck.data, updated_at: row.updatedAt }] : [];
    });
}
