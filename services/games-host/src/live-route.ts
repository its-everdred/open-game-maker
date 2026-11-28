import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { Handler } from 'hono';

import { isServableId } from './layout.js';
import { FRAME_OBSERVER, FRAME_OBSERVER_FILE, observeFrameHtml } from './frame-observer.js';
import { openLiveFile } from './live-files.js';
import { mimeForPath } from './mime.js';
import { bootstrapPreviewHtml, PREVIEW_BOOTSTRAP, PREVIEW_BOOTSTRAP_FILE } from './preview-bootstrap.js';

/** The API issues capabilities only after authorizing the game and resolving a ticket-scoped workspace grant. */
async function liveRoot(
  root: string,
  gameId: string,
  accessId: string,
): Promise<{ root: string; version: string; manifest: Record<string, string> } | null> {
  if (!isServableId(gameId) || !/^lv-[0-9a-f-]{36}$/u.test(accessId)) return null;
  try {
    const file = await open(
      join(root, '.live', gameId, `${accessId}.json`),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > 24 * 1024 * 1024) return null;
      const row = JSON.parse(await file.readFile('utf8')) as {
        gameId?: unknown;
        accessId?: unknown;
        root?: unknown;
        version?: unknown;
        grantPath?: unknown;
        grantId?: unknown;
        grantHash?: unknown;
        secretHash?: unknown;
        expiresAt?: unknown;
        manifest?: unknown;
      };
      if (
        row.gameId !== gameId ||
        row.accessId !== accessId ||
        typeof row.root !== 'string' ||
        !isAbsolute(row.root) ||
        typeof row.version !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(row.version) ||
        typeof row.grantPath !== 'string' ||
        !isAbsolute(row.grantPath) ||
        typeof row.grantId !== 'string' ||
        !/^[0-9a-f-]{36}$/u.test(row.grantId) ||
        typeof row.grantHash !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(row.grantHash) ||
        typeof row.secretHash !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(row.secretHash) ||
        !row.manifest ||
        typeof row.manifest !== 'object' ||
        Array.isArray(row.manifest) ||
        typeof row.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(row.expiresAt)) ||
        Date.parse(row.expiresAt) <= Date.now()
      )
        return null;
      const grant = await open(row.grantPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const grantInfo = await grant.stat();
        if (!grantInfo.isFile() || grantInfo.nlink !== 1 || grantInfo.size > 8192) return null;
        const record = JSON.parse(await grant.readFile('utf8')) as { grant?: unknown };
        if (
          record.grant !== row.grantId ||
          createHash('sha256').update(JSON.stringify(record)).digest('hex') !== row.grantHash
        )
          return null;
      } finally {
        await grant.close();
      }
      const secret = await open(
        join(dirname(dirname(row.grantPath)), 'secret'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await secret.stat();
        if (!info.isFile() || info.nlink !== 1 || info.size > 8192) return null;
        if (
          createHash('sha256')
            .update(await secret.readFile())
            .digest('hex') !== row.secretHash
        )
          return null;
      } finally {
        await secret.close();
      }
      return { root: row.root, version: row.version, manifest: row.manifest as Record<string, string> };
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

type ResolvePreview = (gameId: string, accessId: string) => Promise<string | null>;

export function liveEntry(root: string, resolvePreview?: ResolvePreview): Handler {
  return async (context) => {
    const gameId = context.req.param('gameId') ?? '';
    const accessId = context.req.param('accessId') ?? '';
    const resolved = await resolvePreview?.(gameId, accessId).catch(() => null);
    const grant = resolved && (await liveRoot(root, gameId, resolved));
    if (!grant) return context.text('Not Found', 404);
    return context.redirect(
      `/l/${gameId}/${accessId}/${grant.version}/index.html${new URL(context.req.url).search}`,
      302,
    );
  };
}

export function liveAsset(root: string, resolvePreview?: ResolvePreview): Handler {
  return async (context) => {
    const gameId = context.req.param('gameId') ?? '';
    const resolved = await resolvePreview?.(gameId, context.req.param('accessId') ?? '').catch(() => null);
    const grant = resolved && (await liveRoot(root, gameId, resolved));
    const version = context.req.param('version') ?? '';
    if (!grant || version !== grant.version) return context.text('Not Found', 404);
    let path: string;
    try {
      path = decodeURIComponent(new URL(context.req.url).pathname.split('/').slice(5).join('/')) || 'index.html';
    } catch {
      return context.text('Not Found', 404);
    }
    if (path === PREVIEW_BOOTSTRAP_FILE)
      return context.body(PREVIEW_BOOTSTRAP, 200, { 'content-type': 'text/javascript; charset=utf-8' });
    if (path === FRAME_OBSERVER_FILE)
      return context.body(FRAME_OBSERVER, 200, { 'content-type': 'text/javascript; charset=utf-8' });
    const file = await openLiveFile(grant.root, path, version);
    if (!file) return context.text('Not Found', 404);
    let contents: Buffer;
    try {
      const size = (await file.stat()).size;
      if (size > 64 * 1024 * 1024 || !Object.hasOwn(grant.manifest, path)) return context.text('Not Found', 404);
      const buffer = Buffer.alloc(size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const result = await file.read(buffer, offset, buffer.length - offset, offset);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      if (offset !== size) return context.text('Not Found', 404);
      contents = buffer.subarray(0, size);
      if (createHash('sha256').update(contents).digest('hex') !== grant.manifest[path])
        return context.text('Not Found', 404);
    } finally {
      await file.close();
    }
    if (path === 'index.html') {
      let html = bootstrapPreviewHtml(contents.toString('utf8'));
      if (new URL(context.req.url).searchParams.get('frameObserver') === '2') html = observeFrameHtml(html);
      return context.req.method === 'HEAD'
        ? context.body(null, 200, { 'content-type': 'text/html; charset=utf-8' })
        : context.body(html, 200, { 'content-type': 'text/html; charset=utf-8' });
    }
    const size = contents.length;
    const headers = new Headers({
      'Content-Type': mimeForPath(path),
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
    });
    const range = context.req.method === 'GET' ? context.req.header('Range') : undefined;
    const match = range ? /^bytes=(\d*)-(\d*)$/u.exec(range) : null;
    if (match && (match[1] || match[2])) {
      const suffix = !match[1];
      const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
      const end = suffix || !match[2] ? size - 1 : Math.min(Number(match[2]), size - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        headers.set('Content-Range', `bytes */${size}`);
        headers.delete('Content-Length');
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      headers.set('Content-Length', String(end - start + 1));
      return new Response(new Uint8Array(contents.subarray(start, end + 1)), {
        status: 206,
        headers,
      });
    }
    if (context.req.method === 'HEAD') {
      return new Response(null, { headers });
    }
    return new Response(new Uint8Array(contents), { headers });
  };
}
