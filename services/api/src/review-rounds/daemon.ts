import { eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';
import type { FeedFleet } from '@ogm/builder';
import { daemonRowForGame } from '../jobs/daemons.js';

// Operator-registered games can share a repository daemon (resolved by daemonRowForGame); never another repository's.
export function reviewDaemonForGame(db: Db, gameId: string): typeof schema.gameDaemons.$inferSelect | undefined {
  const game = db.select().from(schema.games).where(eq(schema.games.id, gameId)).get();
  if (!game?.githubOwner || !game.githubRepo) return undefined;
  const repo = `${game.githubOwner}/${game.githubRepo}`.toLowerCase();
  const own = daemonRowForGame(db, gameId);
  return own?.repo.toLowerCase() === repo ? own : undefined;
}

export function reviewClientForGame(db: Db, fleet: Pick<FeedFleet, 'daemonFor'>) {
  return async (gameId: string) => {
    const row = reviewDaemonForGame(db, gameId);
    const running = row ? await fleet.daemonFor(row.slug) : null;
    if (!running) throw new Error('review_daemon_unavailable');
    return running.client;
  };
}
