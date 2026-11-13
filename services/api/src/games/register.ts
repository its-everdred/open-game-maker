import { randomUUID } from 'node:crypto';

import { GAMES_ROOT, gameFolder, isReservedGameSlug } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, eq } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import { findGame, type GameRow } from './games.js';
import { findGameBySlugOrId } from './slug.js';

// Registering a game whose repository already exists — a game living in an Open-Games monorepo, say — writes the
// registry row and its daemon row and nothing else. `provisionGame` would create a repository and a `games/<slug>/`
// folder the game already has, so the register path never reaches the provisioner: the next game in the same
// monorepo takes this path instead of a hand-edited row.
//
// The repository's `games/<slug>` folder names the game: its shareable link, its folder and its daemon key are all
// that one slug, so `game_daemons` (keyed by slug) and the Commands poller reach the game's own aiur instance and no
// other game's. The daemon row is the link to that instance: the game's inbox reads its open Commands there, and the
// fleet starts no new daemon for a game whose instance is already running.
export type RegisterGameInput = {
  shareRepoDaemon?: boolean;
  familyId: string;
  ownerId: string;
  title: string;
  repo: { owner: string; name: string; path: string };
  daemon: {
    port: number;
    checkoutPath: string;
    unit: string;
    envFile: string;
    status?: 'stopped' | 'starting' | 'running' | 'idle';
  };
  visibility?: 'listed' | 'private';
  repoVisibility?: 'public' | 'private';
};

// GitHub's own shapes: an owner is letters, digits and inner hyphens; a repository name also allows `.` and `_`.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u;
const REPO = /^[A-Za-z0-9._-]+$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PREFIX = `${GAMES_ROOT}/`;

// The game's slug is the last segment of its repository path, and the path is exactly that folder — `games/<slug>`
// with no nesting — so a registered game's folder, link and daemon all agree.
export function registeredSlug(path: string): string {
  if (!path.startsWith(PREFIX)) throw new HttpError(422, 'repo_path_invalid');
  const slug = path.slice(PREFIX.length);
  if (!SLUG.test(slug) || gameFolder(slug) !== path) throw new HttpError(422, 'repo_path_invalid');
  return slug;
}

export function registerExistingGame(db: Db, input: RegisterGameInput): GameRow {
  const title = input.title.trim();
  if (title === '') throw new HttpError(422, 'title_required');
  if (!OWNER.test(input.repo.owner)) throw new HttpError(422, 'repo_owner_invalid');
  if (!REPO.test(input.repo.name) || input.repo.name === '.' || input.repo.name === '..') {
    throw new HttpError(422, 'repo_name_invalid');
  }

  const slug = registeredSlug(input.repo.path);
  const path = gameFolder(slug);
  // The daemon row's repo follows the fleet's convention (lowercase), so the fleet's next start finds this row.
  const repo = `${input.repo.owner}/${input.repo.name}`.toLowerCase();
  // The slug is the game's identity everywhere else (play link, daemon row, aiur grants), so a taken slug is a
  // conflict rather than a rename: registering `games/blobs` twice would give two games one link.
  if (findGameBySlugOrId(db, slug)) throw new HttpError(409, 'game_slug_taken');
  // The slug is also the game's top-level link (`/<slug>`), so a folder named like an app route cannot register (#591).
  if (isReservedGameSlug(slug)) throw new HttpError(422, 'game_slug_reserved');
  const registered = db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.githubOwner, input.repo.owner),
        eq(schema.games.githubRepo, input.repo.name),
        eq(schema.games.githubPath, path),
      ),
    )
    .get();
  if (registered) throw new HttpError(409, 'game_repo_already_registered');
  // A daemon row's port is unique and its slug is the primary key; the game's own row is the one to refuse here, so a
  // second registration for one instance cannot start two daemons or answer two games' Commands.
  if (
    db.select({ slug: schema.gameDaemons.slug }).from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, slug)).get()
  ) {
    throw new HttpError(409, 'game_daemon_already_registered');
  }
  const repoDaemons = input.shareRepoDaemon
    ? db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.repo, repo)).all()
    : [];
  if (repoDaemons.length > 1 || (repoDaemons.length === 1 && repoDaemons[0]!.port !== input.daemon.port))
    throw new HttpError(409, 'repo_daemon_ambiguous');
  const shared =
    input.shareRepoDaemon &&
    db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.port, input.daemon.port)).get();
  if (shared && (shared.repo !== repo || shared.checkoutPath !== input.daemon.checkoutPath))
    throw new HttpError(409, 'daemon_port_taken');
  if (
    !shared &&
    db
      .select({ port: schema.gameDaemons.port })
      .from(schema.gameDaemons)
      .where(eq(schema.gameDaemons.port, input.daemon.port))
      .get()
  ) {
    throw new HttpError(409, 'daemon_port_taken');
  }

  const id = `g_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  db.transaction((tx) => {
    tx.insert(schema.games)
      .values({
        id,
        familyId: input.familyId,
        ownerId: input.ownerId,
        title,
        slug,
        githubOwner: input.repo.owner,
        githubRepo: input.repo.name,
        githubPath: path,
        repoUrl: `https://github.com/${repo}`,
        visibility: input.visibility ?? 'private',
        repoVisibility: input.repoVisibility ?? 'public',
        createdAt,
      })
      .run();
    if (!shared)
      tx.insert(schema.gameDaemons)
        .values({
          slug,
          repo,
          checkoutPath: input.daemon.checkoutPath,
          unit: input.daemon.unit,
          envFile: input.daemon.envFile,
          port: input.daemon.port,
          status: input.daemon.status ?? 'running',
          createdAt,
        })
        .run();
  });
  return findGame(db, id);
}
