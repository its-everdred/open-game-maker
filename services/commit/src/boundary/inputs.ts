import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { AssetsLockSchema, type AssetsLock } from '@ogm/contracts';

import { mapConcurrent } from '../concurrency.js';
import { GitHubRequestError } from '../github-request.js';
import { normalizeGamePath } from '../paths.js';
import type { GitHubRequest, Repository, Visibility } from '../types.js';
import type { BoundaryActor, BoundaryFile, BoundaryFileStatus, BoundaryInput } from './types.js';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const BINARY_EXTENSIONS = new Set(['glb', 'bin', 'png', 'webp', 'ktx2', 'mp3', 'ogg', 'wav', 'ico', 'woff2']);

type PullFile = { filename: string; status: string; sha: string };
type Pull = { head: { sha: string }; draft: boolean };
type Blob = { content: string; encoding: string; size: number };
type Content = { content: string; encoding: string };
type GitCommit = { tree: { sha: string } };
type TreeEntry = { path?: string; mode?: string; type?: string; sha?: string; size?: number };
type Tree = { truncated: boolean; tree: TreeEntry[] };

export type PullSnapshot = { number: number; headSha: string; draft: boolean };

export class BoundaryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoundaryInputError';
  }
}

function decodeBase64(content: string, encoding: string): Buffer {
  if (encoding !== 'base64') throw new BoundaryInputError('github blob encoding is not base64');
  return Buffer.from(content.replaceAll('\n', ''), 'base64');
}

function fileStatus(status: string): BoundaryFileStatus {
  if (status === 'added' || status === 'removed' || status === 'renamed') return status;
  if (status === 'copied') return 'added';
  return 'modified';
}

function binaryFile(path: string, content: Buffer): boolean {
  const extension = posix.extname(path).slice(1).toLocaleLowerCase();
  return BINARY_EXTENSIONS.has(extension) || content.includes(0);
}

async function fetchBlob(
  request: GitHubRequest,
  repository: Repository,
  sha: string,
  path: string,
): Promise<BoundaryFile> {
  const response = await request<Blob>('GET /repos/{owner}/{repo}/git/blobs/{file_sha}', {
    ...repository,
    repo: repository.name,
    file_sha: sha,
  });
  const raw = decodeBase64(response.data.content, response.data.encoding);
  const binary = binaryFile(path, raw);
  return {
    path,
    status: 'modified',
    bytes: response.data.size,
    sha256: createHash('sha256').update(raw).digest('hex'),
    binary,
    ...(raw.byteLength <= MAX_TEXT_BYTES && !binary ? { content: raw.toString('utf8') } : {}),
  };
}

export async function pullChangedFiles(
  request: GitHubRequest,
  repository: Repository,
  prNumber: number,
): Promise<PullFile[]> {
  const files: PullFile[] = [];
  for (let page = 1; ; page += 1) {
    const response = await request<PullFile[]>('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      ...repository,
      repo: repository.name,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    files.push(...response.data);
    if (response.data.length < 100) return files;
  }
}

async function readLockfile(request: GitHubRequest, repository: Repository, ref: string): Promise<AssetsLock | null> {
  let response;
  try {
    response = await request<Content>('GET /repos/{owner}/{repo}/contents/{path}', {
      ...repository,
      repo: repository.name,
      path: 'assets.lock.json',
      ref,
    });
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return null;
    throw error;
  }
  const raw = decodeBase64(response.data.content, response.data.encoding).toString('utf8');
  const parsed = AssetsLockSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new BoundaryInputError('assets.lock.json is invalid');
  return parsed.data;
}

function baseInput(input: {
  actor?: BoundaryActor;
  blocklist: ReadonlySet<string> | null;
  draft: boolean;
  files: BoundaryFile[];
  lockfile: AssetsLock | null;
  profileNames: string[];
  visibility: Visibility;
  mode: 'diff' | 'tree';
  gamePath?: string;
  promotion?: boolean;
}): BoundaryInput {
  return {
    actor: input.actor ?? 'agent',
    ...input,
    ...(input.gamePath === undefined ? {} : { gamePath: input.gamePath }),
    ...(input.promotion === true ? { promotion: true } : {}),
  };
}

export async function buildDiffInput(options: {
  request: GitHubRequest;
  repository: Repository;
  prNumber: number;
  pull?: PullSnapshot;
  actor?: BoundaryActor;
  blocklist: ReadonlySet<string> | null;
  profileNames: string[];
  gamePath?: string;
  promotion?: boolean;
  changed?: PullFile[];
}): Promise<{ headSha: string; input: BoundaryInput }> {
  let pull = options.pull;
  if (pull === undefined) {
    const response = await options.request<Pull>('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      ...options.repository,
      repo: options.repository.name,
      pull_number: options.prNumber,
    });
    pull = {
      number: options.prNumber,
      headSha: response.data.head.sha,
      draft: response.data.draft,
    };
  }
  const changed = options.changed ?? (await pullChangedFiles(options.request, options.repository, options.prNumber));
  const files = await mapConcurrent(changed, 8, async (changedFile): Promise<BoundaryFile> => {
    const status = fileStatus(changedFile.status);
    if (status === 'removed') {
      return {
        path: changedFile.filename,
        status,
        bytes: 0,
        sha256: '',
        binary: false,
      };
    }
    return {
      ...(await fetchBlob(options.request, options.repository, changedFile.sha, changedFile.filename)),
      status,
    };
  });
  const lockfile = await readLockfile(options.request, options.repository, pull.headSha);
  return {
    headSha: pull.headSha,
    input: baseInput({
      actor: options.actor,
      blocklist: options.blocklist,
      draft: pull.draft,
      files,
      lockfile,
      profileNames: options.profileNames,
      visibility: options.repository.visibility,
      mode: 'diff',
      ...(options.gamePath === undefined ? {} : { gamePath: options.gamePath }),
      ...(options.promotion === true ? { promotion: true } : {}),
    }),
  };
}

export async function buildTreeInput(options: {
  request: GitHubRequest;
  repository: Repository;
  sha: string;
  visibility?: Visibility;
  actor?: BoundaryActor;
  blocklist: ReadonlySet<string> | null;
  profileNames: string[];
  gamePath?: string;
}): Promise<BoundaryInput> {
  const commit = await options.request<GitCommit>('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
    ...options.repository,
    repo: options.repository.name,
    commit_sha: options.sha,
  });
  const response = await options.request<Tree>('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
    ...options.repository,
    repo: options.repository.name,
    tree_sha: commit.data.tree.sha,
    recursive: '1',
  });
  if (response.data.truncated) throw new BoundaryInputError('github tree response is truncated');

  const blobs = response.data.tree.filter(
    (entry): entry is TreeEntry & Required<Pick<TreeEntry, 'path' | 'sha'>> =>
      entry.type === 'blob' &&
      entry.path !== undefined &&
      entry.sha !== undefined &&
      (options.gamePath === undefined || entry.path.startsWith(`${normalizeGamePath(options.gamePath)}/`)),
  );
  const files = await mapConcurrent(blobs, 8, async (entry): Promise<BoundaryFile> => ({
    ...(await fetchBlob(options.request, options.repository, entry.sha, entry.path)),
    status: 'added',
    mode: entry.mode,
  }));
  const lockfilePath =
    options.gamePath === undefined ? 'assets.lock.json' : `${normalizeGamePath(options.gamePath)}/assets.lock.json`;
  const lockFile = files.find(({ path }) => path === lockfilePath);
  let lockfile: AssetsLock | null = null;
  if (lockFile?.content !== undefined) {
    const parsed = AssetsLockSchema.safeParse(JSON.parse(lockFile.content));
    if (!parsed.success) throw new BoundaryInputError('assets.lock.json is invalid');
    lockfile = parsed.data;
  }
  return baseInput({
    actor: options.actor,
    blocklist: options.blocklist,
    draft: false,
    files,
    lockfile,
    profileNames: options.profileNames,
    visibility: options.visibility ?? options.repository.visibility,
    mode: 'tree',
    ...(options.gamePath === undefined ? {} : { gamePath: options.gamePath }),
  });
}

export async function buildInlineDiffInput(options: {
  request: GitHubRequest;
  repository: Repository;
  baseSha: string;
  files: { path: string; content: string; mode?: string }[];
  actor?: BoundaryActor;
  blocklist: ReadonlySet<string> | null;
  profileNames: string[];
  gamePath?: string;
  promotion?: boolean;
}): Promise<BoundaryInput> {
  const files = inlineFiles(options.files);
  return baseInput({
    actor: options.actor,
    blocklist: options.blocklist,
    draft: false,
    files,
    lockfile: await readLockfile(options.request, options.repository, options.baseSha),
    profileNames: options.profileNames,
    visibility: options.repository.visibility,
    mode: 'diff',
    ...(options.gamePath === undefined ? {} : { gamePath: options.gamePath }),
    ...(options.promotion === true ? { promotion: true } : {}),
  });
}

function inlineFiles(source: { path: string; content: string; mode?: string }[]): BoundaryFile[] {
  return source.map(({ path, content, mode }): BoundaryFile => {
    const raw = Buffer.from(content);
    const binary = binaryFile(path, raw);
    return {
      path,
      status: 'modified',
      bytes: raw.byteLength,
      sha256: createHash('sha256').update(raw).digest('hex'),
      binary,
      ...(binary ? {} : { content }),
      ...(mode === undefined ? {} : { mode }),
    };
  });
}

export function buildInlineTreeInput(options: {
  files: { path: string; content: string; mode?: string }[];
  actor?: BoundaryActor;
  blocklist: ReadonlySet<string> | null;
  profileNames: string[];
  visibility: Visibility;
}): BoundaryInput {
  const files = inlineFiles(options.files).map((file) => ({ ...file, status: 'added' as const }));
  const lockFile = files.find(({ path }) => path === 'assets.lock.json');
  let lockfile: AssetsLock | null = null;
  if (lockFile?.content !== undefined) {
    const parsed = AssetsLockSchema.safeParse(JSON.parse(lockFile.content));
    if (!parsed.success) throw new BoundaryInputError('assets.lock.json is invalid');
    lockfile = parsed.data;
  }
  return baseInput({
    actor: options.actor,
    blocklist: options.blocklist,
    draft: false,
    files,
    lockfile,
    profileNames: options.profileNames,
    visibility: options.visibility,
    mode: 'tree',
  });
}

export async function mainHead(request: GitHubRequest, repository: Repository): Promise<string> {
  const response = await request<{ object: { sha: string } }>('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    ...repository,
    repo: repository.name,
    ref: 'heads/main',
  });
  return response.data.object.sha;
}
