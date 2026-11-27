import type { AppDeps } from '../app/types.js';

export type PublishedBuild = { game_id: string; build_id: string; visibility: string };

/** A pointer grants access only when its release, snapshot, and tested build agree. */
export function publishedBuilds(deps: AppDeps): PublishedBuild[] {
  return deps.sqlite
    .prepare<[], PublishedBuild>(
      `
    SELECT g.id AS game_id, b.id AS build_id, g.visibility FROM games g
    JOIN releases r ON r.id = g.published_release_id AND r.game_id = g.id
    JOIN builds b ON b.id = r.build_id AND b.game_id = g.id
    JOIN override_snapshots s ON s.id = r.snapshot_id AND s.game_id = g.id AND s.build_id = b.id
    WHERE g.delisted_at IS NULL AND b.status = 'tested' AND b.artifact = 'present'
  `,
    )
    .all();
}

export function currentPublishedBuild(deps: AppDeps, gameId: string): string | undefined {
  return deps.sqlite
    .prepare<[string], { build_id: string }>(
      `
    SELECT b.id AS build_id FROM games g
    JOIN releases r ON r.id = g.published_release_id AND r.game_id = g.id
    JOIN builds b ON b.id = r.build_id AND b.game_id = g.id
    JOIN override_snapshots s ON s.id = r.snapshot_id AND s.game_id = g.id AND s.build_id = b.id
    WHERE g.id = ? AND g.delisted_at IS NULL AND b.status = 'tested' AND b.artifact = 'present'
  `,
    )
    .get(gameId)?.build_id;
}
