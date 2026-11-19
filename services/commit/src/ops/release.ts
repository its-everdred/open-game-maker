import type { AuthenticatedGitHub, CommitResult, GameRepository } from '../types.js';
import { GitHubRequestError } from '../github-request.js';
import { refused } from '../result.js';
import type { OperationContext } from './context.js';
import { gameFolderExists } from './game-folder.js';
import type { ExtractCommitOp } from './operation-types.js';

// Tags are namespaced by the game's folder so two games in one repository can each have v1.0.0.
export function releaseTag(slug: string, semver: string): string {
  return `${slug}/v${semver}`;
}

export async function release(op: ExtractCommitOp<'release'>, context: OperationContext): Promise<CommitResult> {
  const repository = await context.repos.resolve(op.gameId);
  const github = await context.app.forOwner(repository.owner);
  const folder = repository.path;
  if (!(await gameFolderExists({ request: github.request, repository, sha: op.sha, gamePath: folder }))) {
    return refused('path', 'release commit does not contain the game folder', folder);
  }
  const verdict = await context.gate.evaluate({
    kind: op.kind,
    gameId: op.gameId,
    repository,
    sha: op.sha,
    gamePath: folder,
  });
  if (!verdict.allowed) return { ok: false, verdict };

  const identity = await context.app.identity();
  const tag = releaseTag(repository.slug, op.semver);
  const created = await github.request<{ sha: string }>('POST /repos/{owner}/{repo}/git/tags', {
    ...repository,
    repo: repository.name,
    tag,
    message: op.changelog,
    object: op.sha,
    type: 'commit',
    tagger: identity,
  });
  try {
    await github.request('POST /repos/{owner}/{repo}/git/refs', {
      ...repository,
      repo: repository.name,
      ref: `refs/tags/${tag}`,
      sha: created.data.sha,
    });
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 422) {
      const existing = await existingTagSha(github.request, repository, tag, op.sha);
      return existing ? { ok: true, sha: existing } : refused('denylist', 'tag exists');
    }
    throw error;
  }
  return { ok: true, sha: created.data.sha };
}

/* A retried release whose earlier response was lost finds its own tag: same name, same commit. */
async function existingTagSha(
  request: AuthenticatedGitHub['request'],
  repository: GameRepository,
  tag: string,
  commitSha: string,
): Promise<string | null> {
  let ref: { data: { object: { sha: string; type: string } } };
  try {
    ref = await request<{ object: { sha: string; type: string } }>('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      ...repository,
      repo: repository.name,
      ref: `tags/${tag}`,
    });
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return null;
    throw error;
  }
  if (ref.data.object.type !== 'tag') return null;
  const object = await request<{ object: { sha: string } }>('GET /repos/{owner}/{repo}/git/tags/{tag_sha}', {
    ...repository,
    repo: repository.name,
    tag_sha: ref.data.object.sha,
  });
  return object.data.object.sha === commitSha ? ref.data.object.sha : null;
}
