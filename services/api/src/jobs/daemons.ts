import type { AiurClient } from '@ogm/aiur-client';
import type { FeedFleet } from '@ogm/builder';
import { schema, type Db } from '@ogm/db';
import { eq } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import { gameSlugFor } from '../games/games.js';

// A daemon is keyed by the game's slug, so a game id resolves to its row through the game's own slug. Two games in
// one instance repository therefore reach their own daemon and never each other's.
export function daemonRowForGame(db: Db, gameId: string): typeof schema.gameDaemons.$inferSelect | undefined {
  const slug = gameSlugFor(db, gameId);
  if (slug === null) return undefined;
  const current = db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, slug)).get();
  if (current) return current;
  const previous = db
    .select({ slug: schema.gameSlugs.slug })
    .from(schema.gameSlugs)
    .where(eq(schema.gameSlugs.gameId, gameId))
    .all();
  for (const { slug: oldSlug } of previous) {
    const daemon = db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, oldSlug)).get();
    if (daemon) return daemon;
  }
  return undefined;
}

export function createDaemonDirectory(db: Db, fleet: Pick<FeedFleet, 'daemonFor'>) {
  async function clientFor(row: typeof schema.gameDaemons.$inferSelect): Promise<AiurClient> {
    const running = await fleet.daemonFor(row.slug);
    if (!running) throw new HttpError(503, 'daemon_credentials_unavailable');
    return running.client;
  }

  return {
    async clientForSlug(slug: string): Promise<AiurClient | null> {
      const row = db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, slug)).get();
      return row ? fleet.daemonFor(row.slug).then((running) => running?.client ?? null) : null;
    },
    // A game's daemon, reached from the game id every job and route carries. Throws when the game has none.
    async clientForGame(gameId: string): Promise<AiurClient> {
      const row = daemonRowForGame(db, gameId);
      if (!row) throw new HttpError(409, 'daemon_not_found');
      return clientFor(row);
    },
  };
}
