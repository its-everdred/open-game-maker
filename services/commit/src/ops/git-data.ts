import { normalizeCommitPath } from '../paths.js';
import type { GitHubIdentity, GitHubRequest } from '../types.js';

// `120000` is a symlink whose content is its target; `100755` an executable.
export type ContentFile = { path: string; content: string; mode?: '100644' | '100755' | '120000' };

export async function createTreeFromFiles(
  request: GitHubRequest,
  repo: { owner: string; name: string },
  files: ContentFile[],
  baseTree?: string,
): Promise<string> {
  const tree = files.map((file) => ({
    path: normalizeCommitPath(file.path),
    mode: file.mode ?? '100644',
    type: 'blob' as const,
    content: file.content,
  }));
  const response = await request<{ sha: string }>('POST /repos/{owner}/{repo}/git/trees', {
    owner: repo.owner,
    repo: repo.name,
    ...(baseTree === undefined ? {} : { base_tree: baseTree }),
    tree,
  });
  return response.data.sha;
}

export type TreeEntry = { path: string; mode: string; type: 'blob' | 'commit'; sha: string | null };

// A tree built from blobs that already exist in the repository: copying or restoring a folder moves no bytes.
// A `null` sha deletes that path from the base tree, which is how a folder is replaced in one commit.
export async function createTree(
  request: GitHubRequest,
  repo: { owner: string; name: string },
  entries: TreeEntry[],
  baseTree?: string,
): Promise<string> {
  const tree = entries.map((entry) => ({
    path: normalizeCommitPath(entry.path),
    mode: entry.mode,
    type: entry.type,
    sha: entry.sha,
  }));
  const response = await request<{ sha: string }>('POST /repos/{owner}/{repo}/git/trees', {
    owner: repo.owner,
    repo: repo.name,
    ...(baseTree === undefined ? {} : { base_tree: baseTree }),
    tree,
  });
  return response.data.sha;
}

export async function createCommit(
  request: GitHubRequest,
  repo: { owner: string; name: string },
  message: string,
  tree: string,
  identity: GitHubIdentity,
  parents: string[] = [],
): Promise<string> {
  const response = await request<{ sha: string }>('POST /repos/{owner}/{repo}/git/commits', {
    owner: repo.owner,
    repo: repo.name,
    message,
    tree,
    parents,
    author: identity,
    committer: identity,
  });
  return response.data.sha;
}
