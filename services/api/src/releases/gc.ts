import { rm } from 'node:fs/promises';

import { schema } from '@ogm/db';
import { buildDir, gcBlobs } from '@ogm/games-host/layout';
import { eq } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import { withArtifactMutation } from '../builds/artifact-lock.js';
import { previewBuildDirectories } from '../previews/store.js';
import { buildResponse, ReleaseError } from './service.js';

export async function collectBuildArtifact(deps: AppDeps, buildId: string) {
  return withArtifactMutation(async () => {
    const existing = deps.db.select().from(schema.builds).where(eq(schema.builds.id, buildId)).get();
    if (!existing) throw new ReleaseError('build_not_found', 404);

    if (existing.artifact === 'present') {
      deps.sqlite
        .transaction(() => {
          const referenced = deps.sqlite.prepare('SELECT 1 FROM releases WHERE build_id = ? LIMIT 1').get(buildId);
          if (referenced) throw new ReleaseError('build_referenced', 409);
          deps.sqlite.prepare("UPDATE builds SET artifact = 'gc' WHERE id = ? AND artifact = 'present'").run(buildId);
        })
        .immediate();
    }

    await rm(buildDir(deps.config.gamesRoot, existing.gameId, existing.id), { recursive: true, force: true });
    const liveBuilds = deps.db
      .select({ id: schema.builds.id, gameId: schema.builds.gameId })
      .from(schema.builds)
      .where(eq(schema.builds.artifact, 'present'))
      .all()
      .map(({ gameId, id }) => buildDir(deps.config.gamesRoot, gameId, id));
    await gcBlobs(deps.config.gamesRoot, [...liveBuilds, ...(await previewBuildDirectories(deps))]);

    return buildResponse({ ...existing, artifact: 'gc' });
  });
}
