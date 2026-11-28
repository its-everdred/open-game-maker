import { schema } from '@ogm/db';
import type { AppDeps } from '../app/types.js';
import type { ReleaseRuntime } from './service.js';

function nextNumber(deps: AppDeps, gameId: string): number {
  const released =
    deps.sqlite
      .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM releases WHERE game_id = ?')
      .get(gameId)?.count ?? 0;
  const reserved =
    deps.sqlite
      .prepare<[string], { highest: number | null }>(
        'SELECT MAX(number) AS highest FROM release_tag_reservations WHERE game_id = ?',
      )
      .get(gameId)?.highest ?? 0;
  return Math.max(released, reserved) + 1;
}

function version(runtime: ReleaseRuntime, number: number): string {
  return runtime.deriveVersion({ publishCount: number, buildsSinceFork: 0, txSinceLatestBuild: 0 });
}

/** A preview can change if another release reserves a number before this caller publishes. */
export function nextReleaseVersion(deps: AppDeps, runtime: ReleaseRuntime, gameId: string): string {
  return version(runtime, nextNumber(deps, gameId));
}

/** Reserve before any remote tag is created, so an orphan never blocks the following release. */
export function reserveReleaseVersion(deps: AppDeps, runtime: ReleaseRuntime, gameId: string): string {
  return deps.sqlite
    .transaction(() => {
      const number = nextNumber(deps, gameId);
      deps.db.insert(schema.releaseTagReservations).values({ gameId, number }).run();
      return version(runtime, number);
    })
    .immediate();
}
