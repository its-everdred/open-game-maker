import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, readdir, readlink, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

import { schema } from '@ogm/db';

import type { AppDeps } from '../app/types.js';
import { ARCHIVE_LIMITS } from '../builds/untar.js';
import { mintPreviewToken, verifyPreviewToken } from '../builds/preview-token.js';
import { findGameBySlugOrId } from '../games/slug.js';
import { hookPreviewToken } from '../internal/bundle.js';
import { createPreview } from './store.js';
import type { PreviewTicketVerifier } from './ticket.js';

const requestName = /^[0-9a-f-]{36}\.json$/u;
const SHA = /^[0-9a-f]{40}$/u;
const ticketPattern = /^[1-9]\d{0,15}$/u;
const branchPattern = /^[A-Za-z0-9_-]{1,200}$/u;

const refreshAttempts = new Map<string, number>();
type Request = { state: string; token: string; ticket: string; slug: string; sha: string; branch: string };
type RepoGrant = { repo: string; ticket: string; game: string; grant: string; secret: string; workspace: string };

// Check the opened descriptor, not only the path: workers control every workspace directory.
async function openWithin(file: string, directory: string, flags: number) {
  const handle = await open(file, flags | constants.O_NOFOLLOW);
  try {
    const actual = await readlink(`/proc/self/fd/${handle.fd}`);
    const stat = await handle.stat();
    if (!actual.startsWith(directory + sep) || !stat.isFile() || stat.nlink !== 1) throw new Error('unsafe_file');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function processRequest(
  deps: AppDeps,
  home: string,
  dir: string,
  filename: string,
  verifyTicket: PreviewTicketVerifier,
  repoGrant?: RepoGrant,
): Promise<void> {
  let request;
  let directory;
  let response;
  try {
    directory = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if ((await readlink(`/proc/self/fd/${directory.fd}`)) !== dir) return;
    request = await openWithin(join(dir, filename), dir, constants.O_RDONLY);
    if ((await request.stat()).size > 8192) return;
    const requestBuffer = Buffer.alloc(8193);
    const requestRead = await request.read(requestBuffer, 0, requestBuffer.length, 0);
    if (requestRead.bytesRead > 8192) return;
    const data = JSON.parse(requestBuffer.subarray(0, requestRead.bytesRead).toString('utf8')) as Request;
    if (data.state !== 'pending') return;
    response = await open(
      `/proc/self/fd/${directory.fd}/${filename.replace(/\.json$/u, '.response')}`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    let result: Record<string, string>;
    try {
      if (
        typeof data.token !== 'string' ||
        typeof data.ticket !== 'string' ||
        !ticketPattern.test(data.ticket) ||
        typeof data.slug !== 'string' ||
        typeof data.sha !== 'string' ||
        !SHA.test(data.sha) ||
        typeof data.branch !== 'string' ||
        !branchPattern.test(data.branch)
      )
        throw new Error('invalid_request');
      const game = findGameBySlugOrId(deps.db, data.slug);
      const workspace = join(dir, '..', '..');
      let authorized = false;
      if (repoGrant) {
        const claims = verifyPreviewToken(data.token, repoGrant.secret);
        authorized =
          !!claims &&
          claims.ticket === data.ticket &&
          claims.game === data.slug &&
          claims.game === repoGrant.game &&
          claims.ticket === repoGrant.ticket &&
          claims.grant === repoGrant.grant &&
          workspace === repoGrant.workspace &&
          !!game?.githubOwner &&
          !!game.githubRepo &&
          `${game.githubOwner}/${game.githubRepo}`.toLowerCase() === repoGrant.repo;
      } else {
        const identity = await hookPreviewToken(home)(data.token, deps);
        const workspaceHash = createHash('sha256').update(workspace).digest('hex');
        const grantFile = identity
          ? join(home, '.config/ogm/daemons', identity.slug, 'preview-grants', `${workspaceHash}.json`)
          : '';
        const grant = identity
          ? await readFile(grantFile, 'utf8').then(
              (text) => JSON.parse(text) as { ticket?: string; grant?: string },
              () => null,
            )
          : null;
        authorized =
          !!identity &&
          identity.ticket === data.ticket &&
          identity.game === data.slug &&
          !!grant &&
          grant.ticket === identity.ticket &&
          grant.grant === identity.grant &&
          !!game?.githubOwner &&
          !!game.githubRepo &&
          findGameBySlugOrId(deps.db, identity.slug)?.id === game.id &&
          `${game.githubOwner}/${game.githubRepo}`.toLowerCase() === identity.repo.toLowerCase();
      }
      if (
        !authorized ||
        !game ||
        !game.githubOwner ||
        !game.githubRepo ||
        !(await verifyTicket(`${game.githubOwner}/${game.githubRepo}`, data.ticket, data.slug, !!repoGrant))
      )
        throw new Error('unauthorized');
      const archive = await openWithin(join(dir, filename.replace(/\.json$/u, '.tgz')), dir, constants.O_RDONLY);
      let bytes: Buffer;
      try {
        const stat = await archive.stat();
        if (stat.size > ARCHIVE_LIMITS.compressedBytes) throw new Error('archive_too_large');
        bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await archive.read(bytes, offset, bytes.length - offset, offset);
          if (!read.bytesRead) throw new Error('archive_truncated');
          offset += read.bytesRead;
        }
      } finally {
        await archive.close();
      }
      const preview = await createPreview(deps, game.id, data.ticket, data.sha, bytes, data.branch);
      result = { state: 'done', gameId: preview.gameId, buildId: preview.buildId };
    } catch (error) {
      deps.log({ event: 'preview_relay_failed', reason: error instanceof Error ? error.name : 'Error' });
      result = { state: 'failed', error: 'preview upload refused' };
    }
    const output = Buffer.from(JSON.stringify(result));
    await response.writeFile(output);
  } catch {
    // A workspace can disappear or change while it is being scanned.
  } finally {
    await response?.close();
    await request?.close();
    await directory?.close();
  }
}

async function refreshCredential(
  workspace: string,
  secret: string,
  repo: string,
  ticket: string,
  game: string,
  grant: string,
  verifyTicket: PreviewTicketVerifier,
  requireGameLabel: boolean,
): Promise<void> {
  const context = join(workspace, '.gm', 'context');
  if ((await realpath(context).catch(() => '')) !== context) return;
  let directory;
  try {
    directory = await open(context, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if ((await readlink(`/proc/self/fd/${directory.fd}`)) !== context) return;
    const current = await openWithin(join(context, 'preview.json'), context, constants.O_RDONLY)
      .then(async (handle) => {
        try {
          if ((await handle.stat()).size > 8192) return null;
          const buffer = Buffer.alloc(8193);
          const read = await handle.read(buffer, 0, buffer.length, 0);
          if (read.bytesRead > 8192) return null;
          return JSON.parse(buffer.subarray(0, read.bytesRead).toString('utf8')) as { token?: string };
        } finally {
          await handle.close();
        }
      })
      .catch(() => null);
    const claims = typeof current?.token === 'string' ? verifyPreviewToken(current.token, secret) : null;
    if (
      claims &&
      claims.ticket === ticket &&
      claims.game === game &&
      claims.grant === grant &&
      claims.expires > Date.now() + 30 * 60 * 1000
    )
      return;
    if ((refreshAttempts.get(workspace) ?? 0) > Date.now() - 60_000) return;
    if (refreshAttempts.size >= 5000) refreshAttempts.clear();
    refreshAttempts.set(workspace, Date.now());
    if (!(await verifyTicket(repo, ticket, game, requireGameLabel))) return;
    const path = `/proc/self/fd/${directory.fd}`;
    const temporary = `${path}/.preview-${randomUUID()}.tmp`;
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify({ token: mintPreviewToken(secret, ticket, grant, game) }));
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, `${path}/preview.json`);
    } finally {
      await rm(temporary, { force: true });
    }
  } catch {
    /* Workspaces may disappear while they are being refreshed. */
  } finally {
    await directory?.close();
  }
}

async function scanDirectory(
  deps: AppDeps,
  home: string,
  root: string,
  depth: number,
  verifyTicket: PreviewTicketVerifier,
  daemon?: { slug: string; repo: string },
): Promise<void> {
  if (depth > 6) return;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(root, entry.name);
    if (entry.name === '.gm') {
      if (daemon) {
        const hash = createHash('sha256').update(root).digest('hex');
        const secretRoot = join(home, '.config/ogm/daemons', daemon.slug);
        const grant = await readFile(join(secretRoot, 'preview-grants', `${hash}.json`), 'utf8')
          .then(
            (text) => JSON.parse(text) as { ticket: string; game: string; grant: string },
            () => null,
          )
          .catch(() => null);
        const secret = await readFile(join(secretRoot, 'hook-secret'), 'utf8').catch(() => '');
        if (grant && secret.trim())
          await refreshCredential(
            root,
            secret.trim(),
            daemon.repo,
            grant.ticket,
            grant.game,
            grant.grant,
            verifyTicket,
            false,
          );
      }
      const directory = join(path, 'preview');
      const actual = await realpath(directory).catch(() => '');
      if (actual !== directory) continue;
      const files = await readdir(directory).catch(() => []);
      for (const file of files)
        if (requestName.test(file)) await processRequest(deps, home, directory, file, verifyTicket);
    } else await scanDirectory(deps, home, path, depth + 1, verifyTicket, daemon);
  }
}

async function scanRepositoryGrants(deps: AppDeps, home: string, verifyTicket: PreviewTicketVerifier): Promise<void> {
  const games = await deps.db
    .select({ owner: schema.games.githubOwner, repo: schema.games.githubRepo })
    .from(schema.games);
  const repositories = new Set(
    games.filter((game) => game.owner && game.repo).map((game) => `${game.owner}/${game.repo}`.toLowerCase()),
  );
  for (const repo of repositories) {
    const hash = createHash('sha256').update(repo).digest('hex');
    const root = join(home, '.config/ogm/preview-repos', hash);
    const secret = await readFile(join(root, 'secret'), 'utf8').catch(() => '');
    if (!secret.trim()) continue;
    const files = await readdir(join(root, 'grants')).catch(() => []);
    for (const file of files) {
      if (!/^[0-9a-f]{64}\.json$/u.test(file)) continue;
      const data = await readFile(join(root, 'grants', file), 'utf8')
        .then(
          (text) => JSON.parse(text) as Partial<RepoGrant>,
          () => null,
        )
        .catch(() => null);
      if (
        !data ||
        data.repo !== repo ||
        typeof data.workspace !== 'string' ||
        typeof data.ticket !== 'string' ||
        typeof data.grant !== 'string' ||
        typeof data.game !== 'string' ||
        createHash('sha256').update(data.workspace).digest('hex') + '.json' !== file
      )
        continue;
      await refreshCredential(
        data.workspace,
        secret.trim(),
        repo,
        data.ticket,
        data.game,
        data.grant,
        verifyTicket,
        true,
      );
      const dir = join(data.workspace, '.gm', 'preview');
      if ((await realpath(dir).catch(() => '')) !== dir) continue;
      const entries = await readdir(dir).catch(() => []);
      const grant: RepoGrant = {
        repo,
        workspace: data.workspace,
        ticket: data.ticket,
        game: data.game,
        grant: data.grant,
        secret: secret.trim(),
      };
      for (const entry of entries)
        if (requestName.test(entry)) await processRequest(deps, home, dir, entry, verifyTicket, grant);
    }
  }
}

export async function scanPreviewRelay(
  deps: AppDeps,
  home = homedir(),
  verifyTicket: PreviewTicketVerifier = async () => false,
): Promise<void> {
  await scanRepositoryGrants(deps, home, verifyTicket);
  const rows = await deps.db
    .select({ slug: schema.gameDaemons.slug, repo: schema.gameDaemons.repo })
    .from(schema.gameDaemons);
  for (const { slug, repo } of rows) {
    if (!/^[A-Za-z0-9_-]+$/u.test(slug)) continue;
    const root = join(home, '.local/share/ogm/daemons', slug, 'workspaces');
    await scanDirectory(deps, home, root, 0, verifyTicket, { slug, repo });
  }
}

export function startPreviewRelay(deps: AppDeps, verifyTicket: PreviewTicketVerifier): void {
  let running = false;
  const scan = async () => {
    if (running) return;
    running = true;
    try {
      await scanPreviewRelay(deps, homedir(), verifyTicket);
    } catch (error) {
      deps.log({ event: 'preview_relay_scan_failed', reason: error instanceof Error ? error.name : 'Error' });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void scan(), 2000);
  timer.unref();
  void scan();
}
