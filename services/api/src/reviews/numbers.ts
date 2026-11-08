import { schema, type Db } from '@ogm/db';
import { and, eq, inArray, max } from 'drizzle-orm';

// A review's short number inside its game (#591): each aiur decision gets the next number the first time it is shown,
// in the order given, and keeps it. The next number is one past the highest the game ever handed out, and rows are
// never deleted while the game lives, so a number is never reused.
export function reviewNumbers(db: Db, gameId: string, decisionIds: readonly string[]): Map<string, number> {
  const wanted = [...new Set(decisionIds)];
  if (wanted.length === 0) return new Map();
  return db.transaction((tx) => {
    const numbers = new Map(
      tx
        .select({ decisionId: schema.gameReviews.decisionId, number: schema.gameReviews.number })
        .from(schema.gameReviews)
        .where(and(eq(schema.gameReviews.gameId, gameId), inArray(schema.gameReviews.decisionId, wanted)))
        .all()
        .map((row) => [row.decisionId, row.number] as const),
    );
    const fresh = wanted.filter((decisionId) => !numbers.has(decisionId));
    if (fresh.length === 0) return numbers;

    const highest =
      tx
        .select({ highest: max(schema.gameReviews.number) })
        .from(schema.gameReviews)
        .where(eq(schema.gameReviews.gameId, gameId))
        .get()?.highest ?? 0;
    const createdAt = new Date().toISOString();
    fresh.forEach((decisionId, index) => {
      const number = highest + index + 1;
      tx.insert(schema.gameReviews).values({ gameId, decisionId, number, createdAt }).run();
      numbers.set(decisionId, number);
    });
    return numbers;
  });
}

export function reviewNumber(db: Db, gameId: string, decisionId: string): number {
  return reviewNumbers(db, gameId, [decisionId]).get(decisionId)!;
}
