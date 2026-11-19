import { gameIssueLabel } from '../labels.js';
import { GitHubRequestError } from '../github-request.js';
import { gameFolder } from '../paths.js';
import { refused } from '../result.js';
import type { CommitResult, GameRepository, GitHubRequest } from '../types.js';
import type { OperationContext } from './context.js';
import { excludedFromCopy, gameFolderExists, readGameFolder } from './game-folder.js';
import { createCommit, createTree, createTreeFromFiles, type TreeEntry } from './git-data.js';
import type { ExtractCommitOp } from './operation-types.js';

type CommitData = { tree: { sha: string } };
type Pull = { number: number; title: string };
type MergeResponse = { merged: boolean; message: string; sha?: string };

export const MAX_COPY_FILES = 10_000;
export const MAX_COPY_BYTES = 100 * 1024 * 1024;

// Repo-level paths belong to the instance repository (one workflow, one workspace), never to a game's folder.
function repoLevel(path: string): boolean {
  return path === '.github' || path.startsWith('.github/');
}

/*
 * The marker a create's merge commit carries. A retried create whose earlier response was lost finds its own folder on
 * `main` through this marker and reports the merge instead of refusing the folder as someone else's.
 */
function createMarker(folder: string): string {
  return `Game-Folder: ${folder}`;
}

/*
 * The merge commit this operation already made for the folder. A retried create whose earlier response was lost finds
 * its own folder on `main` and reports that merge instead of refusing the folder as someone else's: the commits that
 * touch the folder are the creates and forks of it, and the marker the merge carries names this one.
 */
async function createdMerge(
  request: GitHubRequest,
  repository: GameRepository,
  folder: string,
  marker: string,
): Promise<string | null> {
  const history = await request<{ sha: string; commit?: { message?: string } }[]>('GET /repos/{owner}/{repo}/commits', {
    ...repository,
    repo: repository.name,
    path: folder,
    per_page: '20',
  });
  const mine = history.data.find(
    (commit) => typeof commit.commit?.message === 'string' && commit.commit.message.includes(marker),
  );
  return mine?.sha ?? null;
}

/*
 * Points the game's branch at this attempt's commit. A branch left behind by an earlier refused attempt would otherwise
 * keep its old head, and the pull request would merge that instead of the folder just built.
 */
async function moveGameBranch(
  request: GitHubRequest,
  repository: GameRepository,
  branch: string,
  sha: string,
): Promise<void> {
  try {
    await request('POST /repos/{owner}/{repo}/git/refs', {
      ...repository,
      repo: repository.name,
      ref: `refs/heads/${branch}`,
      sha,
    });
  } catch (error) {
    if (!(error instanceof GitHubRequestError) || error.status !== 422) throw error;
    await request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      ...repository,
      repo: repository.name,
      ref: `heads/${branch}`,
      sha,
      force: true,
    });
  }
}

// The pull request for this game's branch, reusing the open one a refused attempt left behind.
async function openPull(
  request: GitHubRequest,
  repository: GameRepository,
  branch: string,
  title: string,
): Promise<Pull> {
  try {
    const created = await request<Pull>('POST /repos/{owner}/{repo}/pulls', {
      ...repository,
      repo: repository.name,
      head: branch,
      base: 'main',
      title,
    });
    return created.data;
  } catch (error) {
    if (!(error instanceof GitHubRequestError) || error.status !== 422) throw error;
    const existing = await request<Pull[]>('GET /repos/{owner}/{repo}/pulls', {
      ...repository,
      repo: repository.name,
      head: `${repository.owner}:${branch}`,
      state: 'open',
    });
    const pull = existing.data[0];
    if (pull === undefined) throw error;
    return pull;
  }
}

function sameRepository(left: GameRepository, right: GameRepository): boolean {
  return left.owner === right.owner && left.name === right.name;
}

/*
 * A fork's blobs already live in the instance repository, so the copy reuses their shas; a source in another
 * repository (a per-game repository kept read-only) is copied blob by blob instead.
 */
async function copiedEntries(
  op: ExtractCommitOp<'create_game'>,
  context: OperationContext,
  destination: GameRepository,
  folder: string,
): Promise<CommitResult | TreeEntry[]> {
  const source = op.from;
  if (source === undefined) return [];
  const sourceRepository = await context.repos.resolve(source.gameId);
  const sourceGitHub = await context.app.forOwner(sourceRepository.owner);
  const destinationGitHub = sameRepository(sourceRepository, destination)
    ? sourceGitHub
    : await context.app.forOwner(destination.owner);
  const { entries, truncated } = await readGameFolder({
    request: sourceGitHub.request,
    repository: sourceRepository,
    sha: source.sha,
    gamePath: sourceRepository.path,
  });
  if (truncated) return refused('size', 'source game folder is too large to fork');

  const copied: TreeEntry[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    if (excludedFromCopy(entry.path)) continue;
    if (entry.mode === '120000' || entry.type === 'commit') {
      return refused('path', 'fork source contains a symlink or submodule', entry.path);
    }
    if (entry.size === undefined || !Number.isSafeInteger(entry.size) || entry.size < 0) {
      return refused('size', 'fork source blob size is unavailable', entry.path);
    }
    totalBytes += entry.size;
    if (copied.length >= MAX_COPY_FILES) return refused('size', `fork source exceeds ${MAX_COPY_FILES} files`);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_COPY_BYTES) {
      return refused('size', `fork source exceeds ${MAX_COPY_BYTES} bytes`);
    }
    copied.push({
      path: `${folder}/${entry.path}`,
      mode: entry.mode,
      type: 'blob',
      sha: await copyBlob(sourceGitHub.request, destinationGitHub.request, sourceRepository, destination, entry.sha),
    });
  }
  return copied;
}

async function copyBlob(
  source: GitHubRequest,
  destination: GitHubRequest,
  sourceRepository: GameRepository,
  destinationRepository: GameRepository,
  sha: string,
): Promise<string> {
  if (sameRepository(sourceRepository, destinationRepository)) return sha;
  const blob = await source<{ content: string; encoding: string }>('GET /repos/{owner}/{repo}/git/blobs/{file_sha}', {
    ...sourceRepository, repo: sourceRepository.name,
    file_sha: sha,
  });
  const created = await destination<{ sha: string }>('POST /repos/{owner}/{repo}/git/blobs', {
    ...destinationRepository, repo: destinationRepository.name,
    content: blob.data.content,
    encoding: blob.data.encoding,
  });
  return created.data.sha;
}

/*
 * Creates a game as a folder in the instance repository: the game's files land on a branch off `main`, the bot opens a
 * pull request and merges it. No repository is created, and the folder's first commit is what later releases tag.
 * A fork copies the source game's folder instead of rendering the template.
 */
export async function createGame(op: ExtractCommitOp<'create_game'>, context: OperationContext): Promise<CommitResult> {
  const folder = gameFolder(op.slug);
  const repository = await context.repos.resolve(op.gameId);
  if (repository.path !== folder) {
    return refused('path', 'game folder does not match its registry path', repository.path);
  }
  const github = await context.app.forOwner(repository.owner);
  const head = await github.request<{ object: { sha: string } }>('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    ...repository,
    repo: repository.name,
    ref: 'heads/main',
  });
  const base = await github.request<CommitData>('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
    ...repository,
    repo: repository.name,
    commit_sha: head.data.object.sha,
  });
  const marker = createMarker(folder);
  if (await gameFolderExists({ request: github.request, repository, sha: head.data.object.sha, gamePath: folder })) {
    const existing = await createdMerge(github.request, repository, folder, marker);
    if (existing !== null) return { ok: true, sha: existing };
    return refused('denylist', 'game folder already exists in the instance repository', folder);
  }

  let tree: string;
  if (op.from === undefined) {
    const rendered = await context.templates.render(op.templateRef, {
      gameId: op.gameId,
      owner: repository.owner,
      visibility: op.visibility,
    });
    const files = rendered.files
      .filter((file) => !repoLevel(file.path))
      .map(({ path, content, mode }) => ({ path: `${folder}/${path}`, content, mode }));
    tree = await createTreeFromFiles(github.request, repository, files, base.data.tree.sha);
  } else {
    const copied = await copiedEntries(op, context, repository, folder);
    if (!Array.isArray(copied)) return copied;
    tree = await createTree(github.request, repository, copied, base.data.tree.sha);
  }

  const identity = await context.app.identity();
  const message =
    op.from === undefined
      ? `chore: add game ${op.slug}`
      : `fork: ${op.from.gameId}@${op.from.sha}\n\nForked-From: ${op.from.gameId}@${op.from.sha}`;
  const sha = await createCommit(github.request, repository, message, tree, identity, [head.data.object.sha]);

  const verdict = await context.gate.evaluate({
    kind: 'create_game',
    gameId: op.gameId,
    repository,
    targetVisibility: op.visibility,
    sha,
    gamePath: folder,
  });
  if (!verdict.allowed) return { ok: false, verdict };

  await ensureGameLabel(github.request, repository, op.slug);
  const branch = `game/${op.slug}`;
  await moveGameBranch(github.request, repository, branch, sha);
  const title = op.from === undefined ? `Add game ${op.slug}` : `Fork ${op.from.gameId} into ${op.slug}`;
  const pull = await openPull(github.request, repository, branch, title);
  const merged = await github.request<MergeResponse>('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
    ...repository,
    repo: repository.name,
    pull_number: pull.number,
    sha,
    merge_method: 'squash',
    commit_title: `${title} (#${pull.number})`,
    commit_message: marker,
  });
  if (!merged.data.merged) return refused('denylist', `not mergeable: ${merged.data.message}`);
  return { ok: true, sha: merged.data.sha ?? sha };
}

// Every game's issues carry its own label in the shared repository, so intake can tell whose work it is.
export async function ensureGameLabel(request: GitHubRequest, repository: GameRepository, slug: string): Promise<void> {
  try {
    await request('POST /repos/{owner}/{repo}/labels', {
      ...repository,
      repo: repository.name,
      name: gameIssueLabel(slug),
      color: '0e8a16',
      description: `Game ${slug}`,
    });
  } catch (error) {
    // 422 means the label is already there, which is the state we want.
    if (error instanceof GitHubRequestError && error.status === 422) return;
    throw error;
  }
}
