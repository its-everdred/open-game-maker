import { createHash } from 'node:crypto';

import { GitHubRequestError } from '../src/github-request.js';
import type { GitHubIdentity, GitHubRequest } from '../src/types.js';

/*
 * An in-memory stand-in for the GitHub git-data API, enough of it to run the real commit operations against one
 * instance repository. It keeps blobs, trees, commits and refs so a create, a design fold, a release and a rollback
 * each build on the previous one's commit — which is what makes the instance-monorepo assertions meaningful: two games
 * share one history, and a rollback of one must leave the other's folder alone.
 *
 * It is deliberately not a GitHub emulator: only the routes the commit service calls exist, and anything else throws so
 * a new route cannot pass unnoticed.
 */

export type FixtureBlob = { content: string; encoding: 'base64' };
export type FixtureTreeEntry = { path: string; mode: string; type: 'blob' | 'commit'; sha: string; content?: string };
export type FixtureCommit = {
  sha: string;
  message: string;
  tree: string;
  parents: string[];
  author: GitHubIdentity;
};
export type FixtureTag = { sha: string; tag: string; message: string; object: string; type: 'commit' };
export type FixturePull = { number: number; head: string; base: string; title: string; merged: boolean; sha?: string };
export type FixtureCall = { route: string; parameters: Record<string, unknown> };

type Tree = Map<string, FixtureTreeEntry>;

function sha1(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

function notFound(message: string): never {
  throw new GitHubRequestError(message, 404);
}

function unprocessable(message: string): never {
  throw new GitHubRequestError(message, 422);
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new GitHubRequestError('fixture: expected a string parameter', 400);
  return value;
}

function entriesOf(value: unknown): FixtureTreeEntry[] {
  if (!Array.isArray(value)) throw new GitHubRequestError('fixture: expected tree entries', 400);
  return value as FixtureTreeEntry[];
}

export class FixtureRepository {
  readonly owner: string;
  readonly name: string;
  readonly calls: FixtureCall[] = [];
  readonly #blobs = new Map<string, FixtureBlob>();
  readonly #trees = new Map<string, Tree>();
  readonly #commits = new Map<string, FixtureCommit>();
  readonly #refs = new Map<string, string>();
  readonly #tags = new Map<string, FixtureTag>();
  readonly #pulls: FixturePull[] = [];
  readonly labels = new Set<string>();
  readonly issues: { title: string; labels: string[] }[] = [];

  constructor(options: { owner: string; name: string } = { owner: 'alice', name: 'instance' }) {
    this.owner = options.owner;
    this.name = options.name;
  }

  /* A commit's files as a flat `path -> blob sha` map, which is how a test states what a folder holds. */
  filesAt(commitSha: string): Map<string, string> {
    const commit = this.#commits.get(commitSha);
    if (commit === undefined) notFound(`fixture: no commit ${commitSha}`);
    const tree = this.#trees.get(commit.tree);
    if (tree === undefined) notFound(`fixture: no tree ${commit.tree}`);
    return new Map([...tree].map(([path, entry]) => [path, entry.sha]));
  }

  /* Every path under `prefix`, without the prefix, so a test reads one game's folder as the design log sees it. */
  pathsUnder(commitSha: string, prefix: string): string[] {
    const trimmed = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return [...this.filesAt(commitSha).keys()]
      .filter((path) => path.startsWith(trimmed))
      .map((path) => path.slice(trimmed.length))
      .sort();
  }

  blobText(sha: string): string {
    const blob = this.#blobs.get(sha);
    if (blob === undefined) notFound(`fixture: no blob ${sha}`);
    return Buffer.from(blob.content, 'base64').toString('utf8');
  }

  commitAt(ref: string): FixtureCommit {
    const sha = this.#refs.get(ref);
    if (sha === undefined) notFound(`fixture: no ref ${ref}`);
    return this.commit(sha);
  }

  commit(sha: string): FixtureCommit {
    const commit = this.#commits.get(sha);
    if (commit === undefined) notFound(`fixture: no commit ${sha}`);
    return commit;
  }

  refNames(): string[] {
    return [...this.#refs.keys()].sort();
  }

  /* The head of a branch as a commit object, for asserting what a merge or fold actually produced. */
  head(branch = 'main'): FixtureCommit {
    return this.commitAt(`heads/${branch}`);
  }

  /* Paths whose blob changed between two commits, in either direction. */
  changedPaths(from: string, to: string): string[] {
    const before = this.filesAt(from);
    const after = this.filesAt(to);
    const changed: string[] = [];
    for (const [path, sha] of after) if (before.get(path) !== sha) changed.push(path);
    for (const path of before.keys()) if (!after.has(path)) changed.push(path);
    return changed.sort();
  }

  /* Seeds `main` with an empty commit so the first game has somewhere to branch from. */
  seed(): FixtureCommit {
    const tree = this.#storeTree(new Map());
    const commit = this.#storeCommit({
      message: 'chore: instance repository',
      tree,
      parents: [],
      author: { name: 'ogm-app[bot]', email: 'ogm-app[bot]@users.noreply.github.com' },
    });
    this.#refs.set('heads/main', commit.sha);
    return commit;
  }

  /* The request function the operations receive, dispatching the routes they use. */
  request: GitHubRequest = async <T>(route: string, parameters: Record<string, unknown> = {}) => {
    this.calls.push({ route, parameters });
    return { data: this.#dispatch(route, parameters) as T };
  };

  #dispatch(route: string, parameters: Record<string, unknown>): unknown {
    const [method, template = ''] = route.split(' ', 2);
    const segments = template.replace('/repos/{owner}/{repo}', '').split('/').filter(Boolean);
    const head = segments[0];
    const rest = segments.slice(1);

    if (method === 'GET' && head === 'git' && rest[0] === 'ref') {
      const ref = text(parameters.ref);
      const sha = this.#refs.get(ref);
      if (sha === undefined) notFound(`No ref ${ref}`);
      const type = this.#tags.has(sha) ? 'tag' : 'commit';
      return { object: { sha, type } };
    }
    if (method === 'POST' && head === 'git' && rest[0] === 'refs') {
      const ref = text(parameters.ref).replace(/^refs\//u, '');
      if (this.#refs.has(ref)) unprocessable('Reference already exists');
      this.#refs.set(ref, text(parameters.sha));
      return { ref };
    }
    if (method === 'PATCH' && head === 'git' && rest[0] === 'refs') {
      const ref = text(parameters.ref).replace(/^refs\//u, '');
      const previous = this.#refs.get(ref);
      if (previous === undefined) notFound(`No ref ${ref}`);
      const next = text(parameters.sha);
      // A real PATCH without force only moves a ref forward; the design fold retries on this.
      if (parameters.force !== true && !this.#isAncestor(previous, next)) {
        unprocessable('Update is not a fast-forward');
      }
      this.#refs.set(ref, next);
      return { ref, object: { sha: next } };
    }
    if (method === 'GET' && head === 'git' && rest[0] === 'commits') {
      const commit = this.#commits.get(text(parameters.commit_sha));
      if (commit === undefined) notFound('No commit found');
      return {
        sha: commit.sha,
        message: commit.message,
        tree: { sha: commit.tree },
        parents: commit.parents.map((sha) => ({ sha })),
      };
    }
    if (method === 'POST' && head === 'git' && rest[0] === 'commits') {
      const commit = this.#storeCommit({
        message: text(parameters.message),
        tree: text(parameters.tree),
        parents: Array.isArray(parameters.parents) ? (parameters.parents as string[]) : [],
        author: parameters.author as GitHubIdentity,
      });
      return { sha: commit.sha };
    }
    if (method === 'GET' && head === 'git' && rest[0] === 'trees') {
      const tree = this.#trees.get(text(parameters.tree_sha));
      if (tree === undefined) notFound('No tree found');
      const entries = [...tree.values()].map((entry) => ({
        ...entry,
        ...(entry.type === 'blob' ? { size: this.#sizeOf(entry.sha) } : {}),
      }));
      return { sha: text(parameters.tree_sha), tree: entries, truncated: false };
    }
    if (method === 'POST' && head === 'git' && rest[0] === 'trees') {
      return { sha: this.#applyTree(parameters.base_tree, entriesOf(parameters.tree)) };
    }
    if (method === 'POST' && head === 'git' && rest[0] === 'blobs') {
      const content = text(parameters.content);
      const sha = sha1(content);
      this.#blobs.set(sha, { content, encoding: 'base64' });
      return { sha };
    }
    if (method === 'GET' && head === 'git' && rest[0] === 'blobs') {
      const blob = this.#blobs.get(text(parameters.file_sha));
      if (blob === undefined) notFound('No blob found');
      return { ...blob, size: this.#sizeOf(text(parameters.file_sha)) };
    }
    if (method === 'POST' && head === 'git' && rest[0] === 'tags') {
      const sha = sha1({ tag: parameters.tag, object: parameters.object });
      this.#tags.set(sha, {
        sha,
        tag: text(parameters.tag),
        message: text(parameters.message),
        object: text(parameters.object),
        type: 'commit',
      });
      return { sha };
    }
    if (method === 'GET' && head === 'git' && rest[0] === 'tags') {
      const tag = this.#tags.get(text(parameters.tag_sha));
      if (tag === undefined) notFound('No tag found');
      return { sha: tag.sha, tag: tag.tag, object: { sha: tag.object, type: 'commit' } };
    }
    if (method === 'POST' && head === 'pulls') {
      const pull: FixturePull = {
        number: this.#pulls.length + 1,
        head: text(parameters.head),
        base: text(parameters.base),
        title: text(parameters.title),
        merged: false,
      };
      this.#pulls.push(pull);
      return { number: pull.number, title: pull.title };
    }
    if (method === 'POST' && head === 'labels') {
      const name = text(parameters.name);
      if (this.labels.has(name)) unprocessable('Validation Failed: already_exists');
      this.labels.add(name);
      return { name };
    }
    if (method === 'POST' && head === 'issues') {
      this.issues.push({ title: text(parameters.title), labels: parameters.labels as string[] });
      return { number: this.issues.length };
    }
    if (method === 'PUT' && head === 'pulls' && rest[1] === 'merge') {
      const pull = this.#pulls.find((candidate) => candidate.number === Number(parameters.pull_number));
      if (pull === undefined) notFound('No pull request found');
      const headSha = this.#refs.get(`heads/${pull.head}`);
      if (headSha === undefined) notFound('No head ref found');
      pull.merged = true;
      pull.sha = headSha;
      // A squash merge lands the branch's commit on the base branch as-is, which is what the operations assume.
      this.#refs.set(`heads/${pull.base}`, headSha);
      return { merged: true, message: 'Pull request successfully merged', sha: headSha };
    }
    throw new GitHubRequestError(`fixture: unrouted ${route}`, 404);
  }

  #sizeOf(sha: string): number {
    const blob = this.#blobs.get(sha);
    if (blob === undefined) notFound(`fixture: no blob ${sha}`);
    return Buffer.from(blob.content, 'base64').length;
  }

  #applyTree(base: unknown, entries: FixtureTreeEntry[]): string {
    const tree: Tree = base === undefined ? new Map() : new Map(this.#treeOf(text(base)));
    for (const entry of entries) {
      if (entry.content !== undefined) {
        const content = Buffer.from(entry.content, 'utf8').toString('base64');
        const sha = sha1(content);
        this.#blobs.set(sha, { content, encoding: 'base64' });
        tree.set(entry.path, { path: entry.path, mode: entry.mode, type: entry.type, sha });
      } else if (entry.sha === null) tree.delete(entry.path);
      else tree.set(entry.path, { ...entry, sha: entry.sha });
    }
    return this.#storeTree(tree);
  }

  #treeOf(sha: string): Tree {
    const tree = this.#trees.get(sha);
    if (tree === undefined) notFound(`fixture: no tree ${sha}`);
    return tree;
  }

  #storeTree(tree: Tree): string {
    const sha = sha1([...tree.values()].sort((left, right) => left.path.localeCompare(right.path)));
    this.#trees.set(sha, tree);
    return sha;
  }

  #storeCommit(input: Omit<FixtureCommit, 'sha'>): FixtureCommit {
    const sha = sha1({ message: input.message, tree: input.tree, parents: input.parents });
    const commit = { ...input, sha };
    this.#commits.set(sha, commit);
    return commit;
  }

  #isAncestor(candidate: string, descendant: string): boolean {
    if (candidate === descendant) return true;
    const seen = new Set<string>();
    const pending = [descendant];
    while (pending.length > 0) {
      const sha = pending.pop();
      if (sha === undefined || seen.has(sha)) continue;
      seen.add(sha);
      const commit = this.#commits.get(sha);
      if (commit === undefined) continue;
      for (const parent of commit.parents) {
        if (parent === candidate) return true;
        pending.push(parent);
      }
    }
    return false;
  }
}
