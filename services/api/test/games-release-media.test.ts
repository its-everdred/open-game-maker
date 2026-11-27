import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { expect, it } from 'vitest';

import { gameMedia } from '../src/games/media.js';
import { ids, insertBuild, now, setup } from './release-fixtures.js';

it('keeps listed game media on the published build when a legacy hook stages a newer build', async () => {
  const { deps, source } = setup();
  insertBuild(deps, source);
  insertBuild(deps, source, { id: ids.build2 });
  for (const id of [ids.build, ids.build2]) {
    const dir = join(deps.config.gamesRoot, ids.game, id);
    mkdirSync(join(dir, 'media'), { recursive: true });
    writeFileSync(join(dir, '.complete'), '');
    writeFileSync(join(dir, 'media/thumbnail.png'), 'image');
  }
  deps.db
    .insert(schema.overrideSnapshots)
    .values({
      id: 'snap',
      gameId: ids.game,
      branchId: ids.main,
      buildId: ids.build,
      headRev: 0,
      sha256: 'a'.repeat(64),
      entriesJson: '[]',
      entityOpsJson: '[]',
      createdAt: now,
    })
    .run();
  deps.db
    .insert(schema.releases)
    .values({
      id: 'release',
      gameId: ids.game,
      seq: 1,
      version: '1.0.0',
      buildId: ids.build,
      snapshotId: 'snap',
      gitTag: 'game/v1.0.0',
      kind: 'publish',
      changelogJson: '{}',
      publishedBy: ids.user,
      publishedAt: now,
    })
    .run();
  deps.db.update(schema.games).set({ visibility: 'listed', publishedReleaseId: 'release' }).run();
  deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.build2, ids.main);

  const media = (await gameMedia(deps, [ids.game])).get(ids.game);
  expect(media?.coverUrl).toContain(`/${ids.build}/media/thumbnail.png`);
});

it('does not expose artwork from an unchecked first build of a listed game', async () => {
  const { deps, source } = setup();
  insertBuild(deps, source, { status: 'failed' });
  const dir = join(deps.config.gamesRoot, ids.game, ids.build);
  mkdirSync(join(dir, 'media'), { recursive: true });
  writeFileSync(join(dir, '.complete'), '');
  writeFileSync(join(dir, 'media/thumbnail.png'), 'image');
  deps.db.update(schema.games).set({ visibility: 'listed' }).run();
  deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.build, ids.main);

  expect((await gameMedia(deps, [ids.game])).get(ids.game)).not.toHaveProperty('coverUrl');
});
