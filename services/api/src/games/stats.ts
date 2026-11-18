import { schema, type Db } from '@ogm/db';
import { inArray } from 'drizzle-orm';

export type GameStats = { plays?: number; version?: string };

/** Detail-view stats from play data; a game with no data for a stat simply omits it. */
export function gameStats(db: Db, games: Array<{ id: string; publishedReleaseId: string | null }>) {
  const stats = new Map<string, GameStats>(games.map((game) => [game.id, {}]));
  if (!games.length) return stats;
  const totals = schema.gamePlayTotals;
  const plays = db
    .select({ gameId: totals.gameId, plays: totals.plays })
    .from(totals)
    .where(
      inArray(
        totals.gameId,
        games.map((game) => game.id),
      ),
    )
    .all();
  for (const row of plays) if (row.plays > 0) stats.get(row.gameId)!.plays = row.plays;
  const releaseIds = games.flatMap((game) => (game.publishedReleaseId ? [game.publishedReleaseId] : []));
  if (releaseIds.length) {
    const releases = db
      .select({ gameId: schema.releases.gameId, version: schema.releases.version })
      .from(schema.releases)
      .where(inArray(schema.releases.id, releaseIds))
      .all();
    for (const release of releases) {
      const entry = stats.get(release.gameId);
      if (entry) entry.version = release.version;
    }
  }
  return stats;
}
