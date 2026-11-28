import type { Branch } from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';
import { deriveVersion } from '@ogm/design-log';

type TransactionCountRow = { count: number };

export interface VersionCounts {
  publishCount(gameId: string): Promise<number>;
  buildsSinceFork(branch: Branch): Promise<number>;
  txSinceLatestBuild(branch: Branch): Promise<number>;
  versionFor(branch: Branch): Promise<string>;
}

export function createVersionCounts(sqlite: Sqlite): VersionCounts {
  const counts: VersionCounts = {
    publishCount: async (gameId) =>
      sqlite
        .prepare<[string, string], TransactionCountRow>(
          `SELECT MAX((SELECT COUNT(*) FROM releases WHERE game_id = ?), COALESCE((SELECT CAST(substr(version, 1, instr(version, '.') - 1) AS INTEGER) FROM releases WHERE game_id = ? ORDER BY seq DESC LIMIT 1), 0)) AS count`,
        )
        .get(gameId, gameId)?.count ?? 0,
    buildsSinceFork: async (branch) => {
      const since =
        branch.forkPoint === null
          ? (sqlite
              .prepare<[string], { publishedAt: string | null }>(
                'SELECT MAX(published_at) AS publishedAt FROM releases WHERE game_id = ?',
              )
              .get(branch.gameId)?.publishedAt ?? '')
          : branch.createdAt;
      return (
        sqlite
          .prepare<[string, string], TransactionCountRow>(
            "SELECT COUNT(*) AS count FROM builds WHERE branch_id = ? AND status = 'tested' AND created_at > ?",
          )
          .get(branch.id, since)?.count ?? 0
      );
    },
    txSinceLatestBuild: async (branch) => {
      const row = sqlite
        .prepare<[string, string], TransactionCountRow>(
          `SELECT COUNT(*) AS count
           FROM design_transactions
           WHERE branch_id = ?
             AND rev > COALESCE((
               SELECT MAX(rev)
               FROM design_transactions
               WHERE branch_id = ?
                 AND kind = 'system'
                 AND json_extract(commands_json, '$[0].op') = 'invoke'
                 AND json_extract(commands_json, '$[0].command') = 'build.switch'
             ), 0)`,
        )
        .get(branch.id, branch.id);
      return row?.count ?? 0;
    },
    versionFor: async (branch) => {
      const [publishCount, buildsSinceFork, txSinceLatestBuild] = await Promise.all([
        counts.publishCount(branch.gameId),
        counts.buildsSinceFork(branch),
        counts.txSinceLatestBuild(branch),
      ]);
      return deriveVersion({ publishCount, buildsSinceFork, txSinceLatestBuild });
    },
  };
  return counts;
}
