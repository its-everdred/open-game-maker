import { normalizeGamePath } from '../paths.js';
import type { GitHubRequest, Repository } from '../types.js';

export type FolderEntry = { path: string; mode: string; type: 'blob' | 'commit'; sha: string; size?: number };

type TreeEntry = { path?: string; mode?: string; type?: string; sha?: string; size?: number };
type Tree = { truncated: boolean; tree: TreeEntry[] };

// Paths that never travel with a fork: local design-log scratch and player saves are per working copy.
export function excludedFromCopy(path: string): boolean {
  return path === '.gm' || path.startsWith('.gm/') || path === 'saves' || path.startsWith('saves/');
}

/*
 * The folder prefix a game's paths are relative to. An empty `gamePath` means the repository root: a per-game
 * repository kept read-only from before the instance monorepo keeps its game at the top level.
 */
function folderPrefix(gamePath: string): string {
  if (gamePath === '') return '';
  const normalized = normalizeGamePath(gamePath);
  return `${normalized}/`;
}

/*
 * The entries of one game's folder at a commit, with the folder prefix stripped so a caller sees the same paths the
 * design log and the boundary rules use. Blobs keep their shas, so copying or restoring a folder reuses GitHub's blobs.
 */
export async function readGameFolder(options: {
  request: GitHubRequest;
  repository: Repository;
  sha: string;
  gamePath: string;
}): Promise<{ entries: FolderEntry[]; truncated: boolean }> {
  const commit = await options.request<{ tree: { sha: string } }>(
    'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
    { ...options.repository, repo: options.repository.name, commit_sha: options.sha },
  );
  const tree = await options.request<Tree>('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
    ...options.repository,
    repo: options.repository.name,
    tree_sha: commit.data.tree.sha,
    recursive: '1',
  });
  const prefix = folderPrefix(options.gamePath);
  const entries: FolderEntry[] = [];
  for (const entry of tree.data.tree) {
    if (entry.path === undefined || entry.sha === undefined || entry.mode === undefined) continue;
    if (entry.type !== 'blob' && entry.type !== 'commit') continue;
    if (!entry.path.startsWith(prefix)) continue;
    const relative = entry.path.slice(prefix.length);
    if (relative === '') continue;
    entries.push({
      path: relative,
      mode: entry.mode,
      type: entry.type,
      sha: entry.sha,
      ...(entry.size === undefined ? {} : { size: entry.size }),
    });
  }
  return { entries, truncated: tree.data.truncated };
}

// The game's folder as it exists at a commit, or an empty list when the folder is not there.
export async function gameFolderExists(options: {
  request: GitHubRequest;
  repository: Repository;
  sha: string;
  gamePath: string;
}): Promise<boolean> {
  const { entries } = await readGameFolder(options);
  return entries.length > 0;
}
