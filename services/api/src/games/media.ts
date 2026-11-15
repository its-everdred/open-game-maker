import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { buildDir } from '@ogm/games-host/layout';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDeps } from '../app/types.js';

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Media belongs to the current main build, so a new publish updates both URLs atomically. */
export async function gameMedia(deps: AppDeps, gameIds: string[]) {
  if (!gameIds.length) return new Map();
  const branches = deps.db
    .select({ gameId: schema.branches.gameId, buildId: schema.branches.latestBuildId })
    .from(schema.branches)
    .where(and(inArray(schema.branches.gameId, gameIds), eq(schema.branches.name, 'main')))
    .all();
  const entries = await Promise.all(
    branches.map(async ({ gameId, buildId }) => {
      if (!buildId) return [gameId, {}] as const;
      let directory: string;
      try {
        directory = buildDir(deps.config.gamesRoot, gameId, buildId);
      } catch {
        return [gameId, {}] as const;
      }
      if (!(await exists(join(directory, '.complete')))) return [gameId, {}] as const;
      const [cover, landscape, portrait] = await Promise.all([
        exists(join(directory, 'media/thumbnail.png')),
        exists(join(directory, 'media/trailer-landscape.mp4')),
        exists(join(directory, 'media/trailer-portrait.mp4')),
      ]);
      const origin = deps.config.gamesOrigin.replace(/\/$/, '');
      const base = `${origin}/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/media`;
      return [
        gameId,
        {
          ...(cover ? { coverUrl: `${base}/thumbnail.png` } : {}),
          ...(landscape ? { trailerUrl: `${base}/trailer-landscape.mp4` } : {}),
          ...(portrait ? { portraitTrailerUrl: `${base}/trailer-portrait.mp4` } : {}),
        },
      ] as const;
    }),
  );
  return new Map(entries);
}
