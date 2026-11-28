import { homedir } from 'node:os';

import type { AiurClient } from '@ogm/aiur-client';
import { daemonPaths, type FeedFleet } from '@ogm/builder';
import { schema, type Db } from '@ogm/db';
import { asc, eq, sql } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import { gameSlugFor } from '../games/games.js';

// A daemon is keyed by the game's slug, so a game id resolves to its row through the game's own slug. Two games in
// one instance repository therefore reach their own daemon and never each other's. A game registered into a
// repository whose daemon is already registered (`gm games register` shares it) has no row of its own and uses that
// repository's daemon; never guess when more than one matches.
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
  const game = db
    .select({ owner: schema.games.githubOwner, repo: schema.games.githubRepo })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .get();
  if (!game?.owner || !game.repo) return undefined;
  const repo = `${game.owner}/${game.repo}`.toLowerCase();
  const shared = db
    .select()
    .from(schema.gameDaemons)
    .where(sql`lower(${schema.gameDaemons.repo}) = ${repo}`)
    .all();
  return shared.length === 1 ? shared[0] : undefined;
}

// Drafts have no game yet; use an operator-registered daemon, which the fleet will not stop when idle.
export function daemonRowForRepo(db: Db, repo: string): typeof schema.gameDaemons.$inferSelect | undefined {
  const matches = db
    .select()
    .from(schema.gameDaemons)
    .where(sql`lower(${schema.gameDaemons.repo}) = ${repo.toLowerCase()}`)
    .orderBy(asc(schema.gameDaemons.createdAt), asc(schema.gameDaemons.slug))
    .all();
  // `core` is reserved by the chat client resolver for the platform daemon.
  const registered = matches.filter(
    (row) => row.slug !== 'core' && row.checkoutPath !== daemonPaths(homedir(), row.slug).dir,
  );
  return registered.length === 1 ? registered[0] : undefined;
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
