import { createReadStream, type Stats } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { constants as zlib, createBrotliCompress, createGzip } from 'node:zlib';

import { Hono, type Context, type Handler, type MiddlewareHandler } from 'hono';

import { gameHeaders, healthHeaders } from './headers.js';
import { BadBlobName, BadId, blobPath, buildDir, isComplete, resolveFile } from './layout.js';
import { isCompressiblePath, mimeForPath } from './mime.js';

export interface GamesHostOptions {
  appOrigin: string;
  root: string;
  uptimeSec?: () => number;
  version: string;
  workerScript: string;
}

export function createApp(options: GamesHostOptions): Hono {
  const app = new Hono();
  const gameHeaderEntries = Object.entries(gameHeaders(options.appOrigin));
  const uptimeSec = options.uptimeSec ?? (() => process.uptime());

  const secureResponse: MiddlewareHandler = async (context, next) => {
    await next();
    for (const [name, value] of gameHeaderEntries) {
      context.res.headers.set(name, value);
    }
    if (new URL(context.req.url).pathname.startsWith('/p/')) {
      context.res.headers.set('Access-Control-Allow-Origin', '*');
    }
    if (context.res.status !== 200 || new URL(context.req.url).pathname.startsWith('/p/')) {
      context.res.headers.set('Cache-Control', 'no-store');
    } else if (new URL(context.req.url).pathname === '/game-cache.js') {
      context.res.headers.set('Cache-Control', 'no-cache');
    }
    context.res.headers.delete('set-cookie');
  };
  app.use('/g/*', secureResponse);
  app.use('/p/*', secureResponse);
  app.use('/a/*', secureResponse);
  app.use('/game-cache.js', secureResponse);

  app.get('/healthz', (context) =>
    context.json(
      {
        ok: true,
        service: 'games-host',
        uptimeSec: Math.floor(uptimeSec()),
        version: options.version,
      },
      200,
      healthHeaders(),
    ),
  );

  const serveGame: Handler = async (context) => {
    const gameId = context.req.param('gameId') ?? '';
    const buildId = context.req.param('buildId') ?? '';
    let directory: string;
    try {
      if (buildId.startsWith('preview-')) return context.text('Not Found', 404);
      directory = new URL(context.req.url).pathname.startsWith('/p/')
        ? ((await previewDirectory(options.root, gameId, buildId)) ?? '')
        : buildDir(options.root, gameId, buildId);
      if (buildId.startsWith('pv-') && !new URL(context.req.url).pathname.startsWith('/p/'))
        return context.text('Not Found', 404);
      if (!directory) return context.text('Not Found', 404);
    } catch (error) {
      if (error instanceof BadId) {
        return context.text('Not Found', 404);
      }
      throw error;
    }

    if (!(await isComplete(directory))) {
      return context.text('Not Found', 404);
    }

    const urlPath = new URL(context.req.url).pathname.split('/').slice(4).join('/');
    const file = await resolveFile(directory, urlPath);
    if (file === null) {
      return context.text('Not Found', 404);
    }

    const relativePath = relative(directory, file).split(sep).join('/');
    return serveFile(context, file, {
      ETag: `"${buildId}:${encodeURIComponent(relativePath)}"`,
    });
  };

  const serveBlob: Handler = async (context) => {
    const file = context.req.param('file') ?? '';
    let path: string;
    try {
      path = blobPath(options.root, file);
    } catch (error) {
      if (error instanceof BadBlobName) {
        return context.text('Not Found', 404);
      }
      throw error;
    }

    return serveFile(context, path, { ETag: `"${file.slice(0, 64)}"` });
  };

  app.on(['GET', 'HEAD'], '/g/:gameId/:buildId', (context) => {
    const gameId = context.req.param('gameId') ?? '';
    const buildId = context.req.param('buildId') ?? '';
    try {
      buildDir(options.root, gameId, buildId);
    } catch (error) {
      if (error instanceof BadId) {
        return context.text('Not Found', 404);
      }
      throw error;
    }
    return context.redirect(`/g/${gameId}/${buildId}/`, 308);
  });
  app.on(['GET', 'HEAD'], '/g/:gameId/:buildId/*', serveGame);
  app.on(['GET', 'HEAD'], '/p/:gameId/:buildId/*', serveGame);
  app.on(['GET', 'HEAD'], '/a/:file', serveBlob);
  app.on(['GET', 'HEAD'], '/game-cache.js', (context) =>
    serveFile(context, options.workerScript, { 'Service-Worker-Allowed': '/g/' }),
  );

  app.notFound((context) => context.text('Not Found', 404, { 'Cache-Control': 'no-store' }));

  return app;
}

// Preview access IDs are short-lived capabilities issued only by the authorized review API. Resolve every request
// against the current ticket record so answering or replacing it immediately revokes the old capability.
async function previewDirectory(root: string, gameId: string, accessId: string): Promise<string | null> {
  buildDir(root, gameId, 'preview-check');
  if (!/^pv-[0-9a-f-]{36}$/u.test(accessId)) return null;
  const directory = join(root, '.previews', gameId);
  const names = await readdir(directory).catch(() => [] as string[]);
  for (const name of names.filter((entry) => /^[1-9]\d{0,15}\.json$/u.test(entry))) {
    const raw = await readFile(join(directory, name), 'utf8').catch(() => '');
    let row: { gameId?: unknown; accessId?: unknown; accessExpiresAt?: unknown; buildId?: unknown; answered?: unknown };
    try {
      row = JSON.parse(raw) as typeof row;
    } catch {
      continue;
    }
    if (
      row.gameId !== gameId ||
      row.accessId !== accessId ||
      row.answered !== false ||
      typeof row.accessExpiresAt !== 'string' ||
      !Number.isFinite(Date.parse(row.accessExpiresAt)) ||
      Date.parse(row.accessExpiresAt) <= Date.now()
    )
      continue;
    if (typeof row.buildId !== 'string' || !/^preview-[0-9a-f-]{36}$/u.test(row.buildId)) return null;
    return join(directory, '.builds', row.buildId);
  }
  return null;
}

async function serveFile(
  context: Context,
  file: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const fileStat = await regularFileStat(file);
  if (fileStat === null) {
    return context.text('Not Found', 404);
  }

  const headers = new Headers({
    'Content-Type': mimeForPath(file),
    ...extraHeaders,
  });
  let bodyFile = file;
  let bodySize: number | undefined = fileStat.size;
  let encoding: 'br' | 'gzip' | null = null;

  if (isCompressiblePath(file)) {
    headers.set('Vary', 'Accept-Encoding');
    encoding = preferredEncoding(context.req.header('Accept-Encoding'));
    if (encoding === 'br') {
      const precompressed = `${file}.br`;
      const precompressedStat = await regularFileStat(precompressed);
      if (precompressedStat !== null) {
        bodyFile = precompressed;
        bodySize = precompressedStat.size;
      } else {
        bodySize = undefined;
      }
    } else if (encoding === 'gzip') {
      bodySize = undefined;
    }
  }

  if (encoding !== null) {
    headers.set('Content-Encoding', encoding);
  }
  if (bodySize === undefined) {
    headers.delete('Content-Length');
  } else {
    headers.set('Content-Length', String(bodySize));
  }

  if (context.req.method === 'HEAD') {
    return new Response(null, { headers, status: 200 });
  }

  let body: Readable = createReadStream(bodyFile);
  if (encoding === 'br' && bodyFile === file) {
    // Node's default Brotli quality (11) took 38 s to stream a 5.4 MB game bundle, so the game sat blank; quality 5 is
    // a few hundred ms and still well under gzip's size.
    body = body.pipe(createBrotliCompress({ params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } }));
  } else if (encoding === 'gzip') {
    body = body.pipe(createGzip());
  }
  return new Response(Readable.toWeb(body) as unknown as BodyInit, { headers, status: 200 });
}

async function regularFileStat(file: string): Promise<Stats | null> {
  try {
    const fileStat = await stat(file);
    return fileStat.isFile() ? fileStat : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function preferredEncoding(header: string | undefined): 'br' | 'gzip' | null {
  if (header === undefined) {
    return null;
  }

  const qualities = new Map<string, number>();
  for (const item of header.split(',')) {
    const [rawName, ...parameters] = item.trim().split(';');
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;

    let quality = 1;
    const qualityParameter = parameters.map((value) => value.trim()).find((value) => value.startsWith('q='));
    if (qualityParameter !== undefined) {
      const parsed = Number(qualityParameter.slice(2));
      quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
    }
    qualities.set(name, Math.max(qualities.get(name) ?? 0, quality));
  }

  const wildcard = qualities.get('*') ?? 0;
  const brotli = qualities.get('br') ?? wildcard;
  const gzip = qualities.get('gzip') ?? wildcard;
  if (brotli <= 0 && gzip <= 0) {
    return null;
  }
  return brotli >= gzip ? 'br' : 'gzip';
}
