import { Hono } from 'hono';
import { artifactBlobIndex, buildDir, isComplete } from '@ogm/games-host/layout';
import { schema } from '@ogm/db';
import { and, eq } from 'drizzle-orm';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { hasCreatorMembership, issueGrant, validGrant, validPreview } from './grants.js';
import { authorize } from '@ogm/policy';
import { actorFromPrincipal } from '../accounts/families.js';
import { hasGameGrant } from '../games/games.js';
import { currentPublishedBuild, publishedBuilds } from './published.js';

export const prefix = '/api/v1/artifacts';

async function allows(deps: AppDeps, body: unknown): Promise<boolean> {
  if (!body || typeof body !== 'object') return false;
  const request = body as { gameId?: unknown; buildId?: unknown; blob?: unknown; grant?: unknown; preview?: unknown };
  if (typeof request.gameId === 'string' && typeof request.buildId === 'string' && typeof request.grant === 'string') {
    return (
      (await validGrant(deps, request.grant, request.gameId, request.buildId)) &&
      (await isComplete(buildDir(deps.config.gamesRoot, request.gameId, request.buildId)))
    );
  }
  const builds = publishedBuilds(deps).filter((build) => build.visibility === 'listed');
  if (typeof request.gameId === 'string' && typeof request.buildId === 'string' && request.blob === undefined) {
    if (!builds.some((b) => b.game_id === request.gameId && b.build_id === request.buildId)) return false;
    return isComplete(buildDir(deps.config.gamesRoot, request.gameId, request.buildId));
  }
  if (typeof request.blob !== 'string' || !/^[0-9a-f]{64}\.[a-z0-9]{1,12}$/u.test(request.blob)) return false;
  const blob = request.blob;
  for (const build of builds) {
    const directory = buildDir(deps.config.gamesRoot, build.game_id, build.build_id);
    if (!(await isComplete(directory))) continue;
    if ((await artifactBlobIndex(directory, build.game_id, build.build_id)).names.has(blob)) return true;
  }
  return false;
}

export default new Hono<ApiBindings>()
  .post('/authorize', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body && typeof body === 'object' && typeof body.gameId === 'string' && typeof body.preview === 'string') {
      const previewAccessId = await validPreview(c.get('deps'), body.gameId, body.preview).catch(() => null);
      return c.json({ allowed: !!previewAccessId, ...(previewAccessId ? { previewAccessId } : {}) }, 200, {
        'Cache-Control': 'no-store',
      });
    }
    const allowed = await allows(c.get('deps'), body).catch(() => false);
    return c.json({ allowed }, 200, { 'Cache-Control': 'no-store' });
  })
  .post('/grant', async (c) => {
    const principal = c.get('principal');
    const body = (await c.req.json().catch(() => null)) as { gameId?: unknown; buildId?: unknown } | null;
    if (principal.kind !== 'user' || typeof body?.gameId !== 'string' || typeof body.buildId !== 'string')
      return c.notFound();
    const deps = c.get('deps');
    const game = deps.db.select().from(schema.games).where(eq(schema.games.id, body.gameId)).get();
    const build = deps.db
      .select()
      .from(schema.builds)
      .where(
        and(
          eq(schema.builds.id, body.buildId),
          eq(schema.builds.gameId, body.gameId),
          eq(schema.builds.status, 'tested'),
          eq(schema.builds.artifact, 'present'),
        ),
      )
      .get();
    if (!game || !build || !(await isComplete(buildDir(deps.config.gamesRoot, game.id, build.id)))) return c.notFound();
    const owner =
      principal.userId === game.ownerId &&
      principal.familyId === game.familyId &&
      principal.capability === 'creator' &&
      hasCreatorMembership(deps, game.familyId, principal.userId);
    const released = currentPublishedBuild(deps, game.id) === build.id;
    const canPlay =
      !!released &&
      authorize(actorFromPrincipal(principal), 'game.play', {
        familyId: game.familyId,
        ownerId: game.ownerId,
        visibility: game.visibility,
        releaseState: game.releaseState,
        granted: hasGameGrant(deps.db, game.id, principal.userId),
      }).ok;
    if (!owner && !canPlay) return c.notFound();
    const token = await issueGrant(
      deps,
      game.id,
      build.id,
      principal.userId,
      c.req.raw.headers,
      owner ? undefined : 'player',
    );
    return c.json(
      { grant: token, url: `${deps.config.gamesOrigin.replace(/\/$/u, '')}/d/${game.id}/${build.id}/${token}/` },
      200,
      { 'Cache-Control': 'no-store' },
    );
  });
