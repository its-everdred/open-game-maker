type TreeEntry = { path: string; type: string; mode: string };

/** Build a deletion tree only from a complete GitHub tree and an exact game-folder boundary. */
export function qaFolderRemovals(
  folder: string,
  tree: readonly TreeEntry[],
  truncated: boolean,
  scopePaths: readonly string[] = [],
) {
  if (!/^games\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(folder)) throw new Error('invalid QA game folder');
  if (
    scopePaths.some((path) => !/^\.gm\/scope\/[A-Za-z0-9_-]+\.json$/u.test(path)) ||
    new Set(scopePaths).size !== scopePaths.length
  )
    throw new Error('invalid QA scope path');
  if (truncated) throw new Error('GitHub tree is truncated');
  return tree
    .filter(
      (entry) => (entry.path.startsWith(`${folder}/`) || scopePaths.includes(entry.path)) && entry.type !== 'tree',
    )
    .map((entry) => {
      if (
        (scopePaths.includes(entry.path) && (entry.type !== 'blob' || entry.mode !== '100644')) ||
        (entry.type !== 'blob' && entry.type !== 'commit') ||
        !(entry.type === 'commit' ? entry.mode === '160000' : /^(100644|100755|120000)$/u.test(entry.mode)) ||
        entry.path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
      )
        throw new Error('invalid entry in QA game folder');
      return { path: entry.path, type: entry.type, mode: entry.mode, sha: null };
    });
}

export type QaFolderGit = {
  hasOpenCreationPull(): Promise<boolean>;
  recover?(): Promise<{ pull: number; head: string; merged: boolean } | null>;
  readMain(): Promise<{ sha: string; tree: TreeEntry[]; truncated: boolean }>;
  openRemovalPull(base: string, entries: ReturnType<typeof qaFolderRemovals>): Promise<number>;
  /** Resolves only after GitHub confirms the PR merged. */
  mergePull(number: number): Promise<void>;
  folderExists(folder: string): Promise<boolean>;
};

/** Never change main directly; verify the merge and resulting main tree before permitting row cleanup. */
export async function removeQaFolder(
  folder: string,
  git: QaFolderGit,
  requireAbsent = false,
  scopePaths: readonly string[] = [],
) {
  // Validate the folder before issuing even a read against GitHub.
  qaFolderRemovals(folder, [], false);
  if (await git.hasOpenCreationPull()) throw new Error('QA creation pull is still open');
  if (requireAbsent) {
    const main = await git.readMain();
    if (qaFolderRemovals(folder, main.tree, main.truncated, scopePaths).length)
      throw new Error('unprovisioned QA folder appeared during cleanup');
    return { removed: false, pull: null };
  }
  const recovered = await git.recover?.();
  if (recovered) {
    if (!recovered.merged) await git.mergePull(recovered.pull);
    if (await git.folderExists(folder)) throw new Error('QA folder still exists on main');
    return { removed: true, pull: recovered.pull };
  }
  const main = await git.readMain();
  const removals = qaFolderRemovals(folder, main.tree, main.truncated, scopePaths);
  if (removals.length === 0) return { removed: false, pull: null };
  const pull = await git.openRemovalPull(main.sha, removals);
  await git.mergePull(pull);
  if (await git.folderExists(folder)) throw new Error('QA folder still exists on main');
  return { removed: true, pull };
}
