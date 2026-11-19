import type { GitHubRequest } from './qa-new-game-folder-github.js';
import { qaFolderRemovals, type QaFolderGit } from './qa-new-game-folder.js';

/** Accept an old failed row only after a terminal audit and a complete read showing no remote artifacts. */
export async function verifyUnprovisionedQaGame(
  repo: string,
  folder: string,
  gameId: string,
  git: QaFolderGit,
  request: GitHubRequest,
  terminalCreate: (gameId: string) => Promise<boolean>,
): Promise<void> {
  if (!/^g_[A-Za-z0-9_-]+$/u.test(gameId) || !/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u.test(repo))
    throw new Error('invalid QA game or repository');
  qaFolderRemovals(folder, [], false);
  if (!(await terminalCreate(gameId))) throw new Error('no terminal create audit for QA game');
  const main = await git.readMain();
  if (qaFolderRemovals(folder, main.tree, main.truncated).length > 0)
    throw new Error('unprovisioned QA folder exists; ownership needs inspection');
  if (await git.hasOpenCreationPull()) throw new Error('unprovisioned QA creation pull needs inspection');
  const slug = folder.slice('games/'.length);
  const refs = await request('GET', `/repos/${repo}/git/matching-refs/heads/game/${slug}`);
  if (
    !Array.isArray(refs) ||
    refs.some(
      (item) =>
        typeof item !== 'object' || item === null || (item as { ref?: unknown }).ref === `refs/heads/game/${slug}`,
    )
  )
    throw new Error('unprovisioned QA creation branch needs inspection');
}
