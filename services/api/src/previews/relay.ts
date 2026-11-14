import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, readdir, readlink, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

import { schema } from '@ogm/db';

import type { AppDeps } from '../app/types.js';
import { ARCHIVE_LIMITS } from '../builds/untar.js';
import { findGameBySlugOrId } from '../games/slug.js';
import { hookPreviewToken } from '../internal/bundle.js';
import { createPreview } from './store.js';

const requestName = /^[0-9a-f-]{36}\.json$/u;
const SHA = /^[0-9a-f]{40}$/u;
const ticketPattern = /^[1-9]\d{0,15}$/u;
const branchPattern = /^[A-Za-z0-9_-]{1,200}$/u;

type Request = { state: string; token: string; ticket: string; slug: string; sha: string; branch: string };

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

async function processRequest(deps: AppDeps, home: string, dir: string, filename: string): Promise<void> {
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
      const identity = await hookPreviewToken(home)(data.token, deps);
      const game = findGameBySlugOrId(deps.db, data.slug);
      const workspace = join(dir, '..', '..');
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
      if (
        !identity ||
        identity.ticket !== data.ticket ||
        !grant ||
        grant.ticket !== identity.ticket ||
        grant.grant !== identity.grant ||
        !game?.githubOwner ||
        !game.githubRepo ||
        findGameBySlugOrId(deps.db, identity.slug)?.id !== game.id ||
        `${game.githubOwner}/${game.githubRepo}`.toLowerCase() !== identity.repo.toLowerCase()
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

async function scanDirectory(deps: AppDeps, home: string, root: string, depth: number): Promise<void> {
  if (depth > 6) return;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(root, entry.name);
    if (entry.name === '.gm') {
      const directory = join(path, 'preview');
      const actual = await realpath(directory).catch(() => '');
      if (actual !== directory) continue;
      const files = await readdir(directory).catch(() => []);
      for (const file of files) if (requestName.test(file)) await processRequest(deps, home, directory, file);
    } else await scanDirectory(deps, home, path, depth + 1);
  }
}

export async function scanPreviewRelay(deps: AppDeps, home = homedir()): Promise<void> {
  const rows = await deps.db.select({ slug: schema.gameDaemons.slug }).from(schema.gameDaemons);
  for (const { slug } of rows) {
    if (!/^[A-Za-z0-9_-]+$/u.test(slug)) continue;
    const root = join(home, '.local/share/ogm/daemons', slug, 'workspaces');
    await scanDirectory(deps, home, root, 0);
  }
}

export function startPreviewRelay(deps: AppDeps): void {
  let running = false;
  const scan = async () => {
    if (running) return;
    running = true;
    try {
      await scanPreviewRelay(deps);
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
