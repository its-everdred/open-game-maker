import { Hono } from 'hono';
import type { Context } from 'hono';

import { gameFolder } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { asc, eq, isNotNull } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';

export const prefix = '/internal';

function requireCommitService(c: Context<ApiBindings>): void {
  const principal = requirePrincipal(c, ['service']);
  if (principal.service !== 'commit') throw new HttpError(403, 'forbidden');
}

function personalName(name: string, email: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed.toLocaleLowerCase() === email.toLocaleLowerCase()) return undefined;
  return /\s/u.test(trimmed) ? trimmed : undefined;
}

const repositoryColumns = {
  gameId: schema.games.id,
  owner: schema.games.githubOwner,
  name: schema.games.githubRepo,
  visibility: schema.games.repoVisibility,
  path: schema.games.githubPath,
  slug: schema.games.slug,
};

type RepositoryRow = {
  gameId: string;
  owner: string | null;
  name: string | null;
  visibility: 'private' | 'public';
  path: string | null;
  slug: string | null;
};

// The registry stores an assigned repository when present; older rows fall back to the instance repository.
function registeredRepository(
  row: RepositoryRow | undefined,
  instanceRepo: { owner: string; name: string },
): {
  gameId: string;
  owner: string;
  name: string;
  visibility: 'private' | 'public';
  path: string;
  slug: string;
} {
  if (row === undefined) throw new HttpError(404, 'game_not_found');
  const slug = row.slug;
  if (slug === null) throw new HttpError(404, 'game_repository_not_registered');
  return {
    gameId: row.gameId,
    owner: row.owner ?? instanceRepo.owner,
    name: row.name ?? instanceRepo.name,
    visibility: row.visibility,
    path: row.path ?? gameFolder(slug),
    slug,
  };
}

const routes = new Hono<ApiBindings>()
  .get('/games/active-repos', (c) => {
    requireCommitService(c);
    const repositories = c
      .get('deps')
      .db.select(repositoryColumns)
      .from(schema.games)
      .where(isNotNull(schema.games.githubOwner))
      .orderBy(asc(schema.games.id))
      .all()
      .filter(
        (repo): repo is RepositoryRow & { owner: string; name: string; path: string; slug: string } =>
          repo.owner !== null && repo.name !== null && repo.path !== null && repo.slug !== null,
      );
    return c.json({ repositories });
  })
  .get('/games/:id/repo', (c) => {
    requireCommitService(c);
    const row = c
      .get('deps')
      .db.select(repositoryColumns)
      .from(schema.games)
      .where(eq(schema.games.id, c.req.param('id')))
      .get();
    return c.json(registeredRepository(row, c.get('deps').config.instanceRepo));
  })
  .get('/games/:id/pii-terms', (c) => {
    requireCommitService(c);
    const deps = c.get('deps');
    const game = deps.db
      .select({ familyId: schema.games.familyId })
      .from(schema.games)
      .where(eq(schema.games.id, c.req.param('id')))
      .get();
    if (game === undefined) throw new HttpError(404, 'game_not_found');

    const profiles = deps.db
      .select({ name: schema.user.name, email: schema.user.email })
      .from(schema.familyMembers)
      .innerJoin(schema.user, eq(schema.familyMembers.userId, schema.user.id))
      .where(eq(schema.familyMembers.familyId, game.familyId))
      .orderBy(asc(schema.user.name))
      .all();
    const terms = [
      ...new Set(
        profiles.flatMap(({ name, email }) => {
          const profileName = personalName(name, email);
          return profileName === undefined ? [email] : [profileName, email];
        }),
      ),
    ];
    return c.json({ terms });
  });

export default routes;
