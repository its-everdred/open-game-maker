import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { gameMedia } from '../src/games/media.js';
import { makeApp } from './helpers.js';
import { ids, insertBuild, publish, setup } from './release-fixtures.js';

it('selects published media for a viewer when the main branch has a newer draft', async () => {
  const { deps, source } = setup();
  insertBuild(deps, source);
  const { app } = await makeApp(deps);
  expect((await publish(app)).status).toBe(201);
  insertBuild(deps, source, { id: ids.build2 });
  deps.db.update(schema.branches).set({ latestBuildId: ids.build2 }).where(eq(schema.branches.id, ids.main)).run();
  for (const buildId of [ids.build, ids.build2]) {
    const directory = join(deps.config.gamesRoot, ids.game, buildId);
    mkdirSync(join(directory, 'media'), { recursive: true });
    writeFileSync(join(directory, '.complete'), '');
    writeFileSync(join(directory, 'media', 'thumbnail.png'), 'image');
  }
  const viewer = await gameMedia(deps, [ids.game], new Set([ids.game]));
  const owner = await gameMedia(deps, [ids.game]);
  expect(viewer.get(ids.game)?.coverUrl).toContain(ids.build);
  expect(owner.get(ids.game)?.coverUrl).toContain(ids.build2);
});
