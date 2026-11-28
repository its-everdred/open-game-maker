import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { schema } from '@ogm/db';
import { and, eq } from 'drizzle-orm';
import type { AppDeps } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { ARCHIVE_LIMITS, untarGz } from '../builds/untar.js';
import type { GameRow } from '../games/games.js';
import { reviewDaemonForGame } from '../review-rounds/daemon.js';

const runFile = promisify(execFile);
const compress = promisify(gzip);

/** Check rights against the immutable source revision, not generated files under the build's assets directory. */
export async function withReleaseSource<T>(
  deps: AppDeps,
  game: GameRow,
  buildId: string,
  use: (directory: string) => Promise<T>,
): Promise<T> {
  const daemon = reviewDaemonForGame(deps.db, game.id);
  const build = deps.db
    .select({ sha: schema.builds.gitSha })
    .from(schema.builds)
    .where(and(eq(schema.builds.id, buildId), eq(schema.builds.gameId, game.id)))
    .get();
  if (
    !daemon ||
    !build ||
    !/^[0-9a-f]{40}$/u.test(build.sha) ||
    !game.githubPath ||
    game.githubPath.length > 54 ||
    !/^games\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(game.githubPath)
  )
    throw new HttpError(409, 'release_source_unavailable');

  const directory = await mkdtemp(join(deps.config.gamesRoot, '.release-rights-'));
  try {
    try {
      const tree = `${build.sha}:${game.githubPath}`;
      const entries = await runFile('git', ['-C', daemon.checkoutPath, 'ls-tree', '-z', '--name-only', tree], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 60_000,
      });
      // These are the only inputs read by `gm check assets`; omit unrelated game files, including scene symlinks.
      const present = new Set(entries.stdout.split('\0'));
      const paths = ['assets.lock.json', 'assets', 'src', 'index.html'].filter((path) => present.has(path));
      if (paths.length) {
        const listed = await runFile('git', ['-C', daemon.checkoutPath, 'ls-tree', '-r', '-z', tree, '--', ...paths], {
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
          timeout: 60_000,
        });
        const files = listed.stdout
          .split('\0')
          .filter(Boolean)
          .map((record) => {
            const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/su.exec(record);
            if (
              !match ||
              match[3]!.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\\'))
            )
              throw new Error('unsupported source entry');
            return { sha: match[2]!, path: match[3]! };
          });
        const result = await runFile(
          'git',
          ['-C', daemon.checkoutPath, 'archive', '--format=tar', tree, '--', ...paths],
          { encoding: 'buffer', maxBuffer: ARCHIVE_LIMITS.compressedBytes, timeout: 60_000 },
        );
        await untarGz(await compress(result.stdout), directory);
        // Git attributes can omit or rewrite files during archive; never let that hide a rights input.
        for (const file of files) {
          const bytes = await readFile(join(directory, file.path));
          const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
          if (sha !== file.sha) throw new Error('source archive differs from commit');
        }
      }
      // Let gm resolve the current game preference in this isolated source tree.
      await runFile('git', ['-C', directory, 'init', '-q'], { timeout: 15_000 });
      await mkdir(join(directory, '.gm'), { recursive: true });
      await writeFile(
        join(directory, '.gm', 'game.json'),
        JSON.stringify({ allowAiGeneratedAssets: game.allowAiGeneratedAssets }),
      );
    } catch {
      throw new HttpError(409, 'release_source_unavailable');
    }
    return await use(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
