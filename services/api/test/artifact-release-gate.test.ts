import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { currentPublishedBuild } from '../src/artifacts/published.js';
import { ids, insertBuild, setup } from './release-fixtures.js';

// No game on prod has a release until #1505 ships private releases and their backfill. With the gate off, a private
// family game's tested main build must stay playable for its members, or every game stops loading (2026-11-28).
describe('artifact release gate', () => {
  function gated(on: boolean) {
    const { deps, source } = setup();
    insertBuild(deps, source, { id: ids.build });
    deps.db.update(schema.branches).set({ latestBuildId: ids.build }).where(eq(schema.branches.id, ids.main)).run();
    return { deps: { ...deps, config: { ...deps.config, artifactReleaseGate: on } }, source };
  }

  it('treats the tested main build as the playable build while the gate is off', () => {
    const { deps } = gated(false);
    expect(currentPublishedBuild(deps, ids.game)).toBe(ids.build);
  });

  it('never offers an untested main build while the gate is off', () => {
    const { deps } = gated(false);
    deps.db.update(schema.builds).set({ status: 'building' }).where(eq(schema.builds.id, ids.build)).run();
    expect(currentPublishedBuild(deps, ids.game)).toBeUndefined();
  });

  it('requires a release for the playable build while the gate is on', () => {
    const { deps } = gated(true);
    expect(currentPublishedBuild(deps, ids.game)).toBeUndefined();
  });
});
