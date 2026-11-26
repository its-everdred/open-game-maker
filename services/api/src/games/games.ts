import { randomUUID } from 'node:crypto';

import type { Db } from '@ogm/db';
import { schema } from '@ogm/db';
import { and, eq, isNull, or } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { gameFolder } from '@ogm/contracts';
import { assignSlug } from './slug.js';
import { GitHubRateLimitError, ProvisioningOutcomeUnknownError } from './repo-provisioner.js';
import { readQaState } from '../qa/state.js';

export type GameRow = typeof schema.games.$inferSelect;

export class GameProvisioningOutcomeUnknown extends HttpError {
  constructor(gameId: string) {
    super(502, 'repo_provisioning_failed', undefined, { gameId });
  }
}

export function gameResponse(game: GameRow) {
  return {
    id: game.id,
    familyId: game.familyId,
    ownerId: game.ownerId,
    title: game.title,
    slug: game.slug,
    visibility: game.visibility,
    releaseState: game.releaseState,
    repoVisibility: game.repoVisibility,
    repo:
      game.githubOwner && game.githubRepo && game.repoUrl
        ? { owner: game.githubOwner, name: game.githubRepo, url: game.repoUrl }
        : null,
    createdAt: game.createdAt,
    delistedAt: game.delistedAt,
    allowAiGeneratedAssets: game.allowAiGeneratedAssets,
    creationStatus: isGameProvisioning(game.id) ? 'creating' : game.repoUrl === null ? 'failed' : 'ready',
  };
}

export function findGame(db: Db, id: string): GameRow {
  const game = db.select().from(schema.games).where(eq(schema.games.id, id)).get();
  if (!game) throw new HttpError(404, 'game_not_found');
  return game;
}

// A build daemon is keyed by the game's slug, so routes that hold a job's game id resolve the daemon through this.
// Null means the game predates slugs or was never given one; its daemon cannot exist either.
export function gameSlugFor(db: Db, gameId: string): string | null {
  const row = db.select({ slug: schema.games.slug }).from(schema.games).where(eq(schema.games.id, gameId)).get();
  return row?.slug ?? null;
}

export function findGameForFamily(db: Db, id: string, familyId: string): GameRow {
  const game = db
    .select()
    .from(schema.games)
    .where(and(eq(schema.games.id, id), eq(schema.games.familyId, familyId)))
    .get();
  if (!game) {
    const visible = db
      .select({ releaseState: schema.games.releaseState, delistedAt: schema.games.delistedAt })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .get();
    if (visible?.releaseState === 'coming_soon' && visible.delistedAt === null) throw new HttpError(403, 'coming_soon');
    throw new HttpError(404, 'game_not_found');
  }
  return game;
}

export function listGames(db: Db, familyId: string, userId: string): GameRow[] {
  return db
    .select()
    .from(schema.games)
    .where(
      and(
        isNull(schema.games.delistedAt),
        or(
          eq(schema.games.releaseState, 'coming_soon'),
          and(
            eq(schema.games.familyId, familyId),
            or(eq(schema.games.visibility, 'listed'), eq(schema.games.ownerId, userId)),
          ),
        ),
      ),
    )
    .all();
}

export function hasGameGrant(db: Db, gameId: string, userId: string): boolean {
  return (
    Boolean(
      db
        .select({ gameId: schema.gameGrants.gameId })
        .from(schema.gameGrants)
        .where(and(eq(schema.gameGrants.gameId, gameId), eq(schema.gameGrants.userId, userId)))
        .get(),
    ) ||
    Boolean(
      db
        .select({ gameId: schema.gameEarlyAccess.gameId })
        .from(schema.gameEarlyAccess)
        .where(and(eq(schema.gameEarlyAccess.gameId, gameId), eq(schema.gameEarlyAccess.userId, userId)))
        .get(),
    )
  );
}

export function createGameRow(
  db: Db,
  input: {
    familyId: string;
    ownerId: string;
    title: string;
    repoVisibility: 'public' | 'private';
    allowAiGeneratedAssets?: boolean;
    repository?: { owner: string; name: string };
  },
): GameRow {
  const id = `g_${randomUUID()}`;
  const slug = assignSlug(db, input.title);
  const row: typeof schema.games.$inferInsert = {
    id,
    familyId: input.familyId,
    ownerId: input.ownerId,
    title: input.title,
    slug,
    // The registry records the folder the game's files live in. It stays fixed when the title (and slug) changes, so a
    // rename never moves the game's history.
    githubPath: gameFolder(slug),
    githubOwner: input.repository?.owner,
    githubRepo: input.repository?.name,
    visibility: 'private',
    repoVisibility: input.repoVisibility,
    allowAiGeneratedAssets: input.allowAiGeneratedAssets ?? true,
    createdAt: new Date().toISOString(),
  };
  db.insert(schema.games).values(row).run();
  return findGame(db, row.id);
}

const provisioningGames = new Map<string, number>();

export function isGameProvisioning(id: string): boolean {
  return provisioningGames.has(id);
}

export async function provisionGame(deps: AppDeps, game: GameRow): Promise<GameRow> {
  if (game.repoUrl) return game;
  const qa = readQaState(deps.db);
  const isQaCreator = qa?.userId === game.ownerId && qa.familyId === game.familyId;
  if (isQaCreator) {
    const repo = game.githubOwner && game.githubRepo ? `${game.githubOwner}/${game.githubRepo}`.toLowerCase() : '';
    const instance = `${deps.config.instanceRepo.owner}/${deps.config.instanceRepo.name}`.toLowerCase();
    const qaRepo = deps.config.qaInstanceRepo;
    const expected = qaRepo ? `${qaRepo.owner}/${qaRepo.name}`.toLowerCase() : '';
    if (!repo || repo === instance || repo !== expected) throw new HttpError(503, 'qa_repository_not_configured');
  }
  const provisioner = deps.registry.repoProvisioner;
  if (!provisioner) throw new HttpError(503, 'repo_provisioner_unavailable');
  const slug = game.slug;
  if (slug === null) throw new HttpError(409, 'game_slug_missing');

  provisioningGames.set(game.id, (provisioningGames.get(game.id) ?? 0) + 1);
  try {
    const repo = await provisioner.provision({
      id: game.id,
      title: game.title,
      slug,
      visibility: game.repoVisibility,
      ...(isQaCreator && game.githubOwner && game.githubRepo
        ? { repository: { owner: game.githubOwner, name: game.githubRepo } }
        : {}),
    });
    try {
      deps.db
        .update(schema.games)
        .set({ githubOwner: repo.owner, githubRepo: repo.repo, githubPath: repo.path, repoUrl: repo.url })
        .where(eq(schema.games.id, game.id))
        .run();
      return findGame(deps.db, game.id);
    } catch (error) {
      deps.log({ event: 'repo-provision-record-failed', gameId: game.id, error: (error as Error).name });
      throw new GameProvisioningOutcomeUnknown(game.id);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof GitHubRateLimitError) {
      throw new HttpError(502, 'repo_provisioning_failed', error.message);
    }
    if (error instanceof ProvisioningOutcomeUnknownError) {
      deps.log({ event: 'repo-provision-outcome-unknown', gameId: game.id });
      throw new GameProvisioningOutcomeUnknown(game.id);
    }
    deps.log({ event: 'repo-provision-failed', gameId: game.id, error: (error as Error).message });
    throw new HttpError(502, 'repo_provisioning_failed');
  } finally {
    const remaining = (provisioningGames.get(game.id) ?? 1) - 1;
    if (remaining === 0) provisioningGames.delete(game.id);
    else provisioningGames.set(game.id, remaining);
  }
}
