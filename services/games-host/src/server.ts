import { createReadStream, type Stats } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { constants as zlib, createBrotliCompress, createGzip } from 'node:zlib';

import { Hono, type Context, type Handler, type MiddlewareHandler } from 'hono';
import { cachePlanSchema } from '@ogm/contracts';

import { gameHeaders, healthHeaders } from './headers.js';
import { FRAME_OBSERVER, FRAME_OBSERVER_FILE, observeFrameHtml } from './frame-observer.js';
import { BadBlobName, BadId, blobPath, buildDir, isComplete, resolveFile } from './layout.js';
import { isCompressiblePath, mimeForPath } from './mime.js';
import { liveAsset, liveEntry } from './live-route.js';
import { bootstrapPreviewHtml, PREVIEW_BOOTSTRAP, PREVIEW_BOOTSTRAP_FILE } from './preview-bootstrap.js';
import { artifactBlobIndex } from './blob-index.js';
import { rewriteRootReferences } from './root-references.js';
import { scanLegacyText } from './text-scan.js';

export interface GamesHostOptions {
  appOrigin: string;
  root: string;
  uptimeSec?: () => number;
  version: string;
  workerScript: string;
  /** Off (the default until #1505 ships private releases and their backfill): /g/ and /a/ serve every complete
   * build as they did before #1473; draft grants (/d/) and previews (/p/) are checked either way. */
  releaseGate?: boolean;
  authorize?: (request: {
    gameId?: string;
    buildId?: string;
    blob?: string;
    grant?: string;
    preview?: string;
  }) => Promise<boolean>;
  resolvePreview?: (gameId: string, accessId: string) => Promise<string | null>;
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
    if (/^\/(?:p|d|l)\//u.test(new URL(context.req.url).pathname)) {
      context.res.headers.set('Access-Control-Allow-Origin', '*');
      const policy = context.res.headers.get('Content-Security-Policy');
      if (policy)
        context.res.headers.set('Content-Security-Policy', `${policy}; sandbox allow-scripts allow-pointer-lock`);
    }
    if (context.res.status !== 200 || /^(?:\/p\/|\/d\/|\/l\/|\/g\/|\/a\/)/u.test(new URL(context.req.url).pathname)) {
      context.res.headers.set('Cache-Control', 'no-store');
    } else if (new URL(context.req.url).pathname === '/game-cache.js') {
      context.res.headers.set('Cache-Control', 'no-cache');
    }
    context.res.headers.delete('set-cookie');
  };
  app.use('/g/*', secureResponse);
  app.use('/p/*', secureResponse);
  app.use('/l/*', secureResponse);
  app.use('/d/*', secureResponse);
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
      const previewId = new URL(context.req.url).pathname.startsWith('/p/')
        ? await options.resolvePreview?.(gameId, buildId).catch(() => null)
        : undefined;
      directory = new URL(context.req.url).pathname.startsWith('/p/')
        ? previewId
          ? ((await previewDirectory(options.root, gameId, previewId)) ?? '')
          : ''
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

    const isDraft = new URL(context.req.url).pathname.startsWith('/d/');
    const grant = isDraft ? context.req.param('grant') : undefined;
    if (isDraft && (!grant || !/^[A-Za-z0-9_-]{43,2048}$/u.test(grant))) return context.text('Not Found', 404);
    if (
      !new URL(context.req.url).pathname.startsWith('/p/') &&
      (options.releaseGate || isDraft) &&
      !(await options.authorize?.({ gameId, buildId, ...(grant ? { grant } : {}) }).catch(() => false))
    ) {
      return context.text('Not Found', 404);
    }
    const isPreview = new URL(context.req.url).pathname.startsWith('/p/');
    const draftIndex = !isPreview ? await artifactBlobIndex(directory, gameId, buildId) : undefined;
    const forkSource =
      draftIndex?.source && (draftIndex.source.gameId !== gameId || draftIndex.source.buildId !== buildId)
        ? draftIndex.source
        : undefined;

    const urlPath = new URL(context.req.url).pathname
      .split('/')
      .slice(isDraft ? 5 : 4)
      .join('/');
    if (
      !isPreview &&
      !isDraft &&
      !forkSource &&
      (urlPath === '' || urlPath === 'index.html') &&
      !new URL(context.req.url).searchParams.has('frameObserver')
    ) {
      const raw = await readFile(join(directory, 'assets/cache-plan.json'), 'utf8').catch(() => null);
      if (raw !== null) {
        try {
          const plan = cachePlanSchema.safeParse(JSON.parse(raw) as unknown);
          const entry = plan.success
            ? plan.data.entries.find(({ sourcePath }) => sourcePath === 'index.html')
            : undefined;
          const address = entry && /^\/a\/([0-9a-f]{64})\.[a-z0-9]{1,12}$/u.exec(entry.url);
          if (entry && address?.[1] === entry.sha256) return context.redirect(entry.url, 308);
        } catch {
          // A malformed optional cache plan must not make an otherwise servable legacy build unavailable.
        }
      }
    }
    if (urlPath === FRAME_OBSERVER_FILE)
      return context.body(FRAME_OBSERVER, 200, { 'content-type': 'text/javascript; charset=utf-8' });
    if ((isPreview || isDraft) && urlPath === PREVIEW_BOOTSTRAP_FILE)
      return context.body(PREVIEW_BOOTSTRAP, 200, { 'content-type': 'text/javascript; charset=utf-8' });
    let file = await resolveFile(directory, urlPath);
    if (isDraft && file === null && /^a\/[0-9a-f]{64}\.[a-z0-9]{1,12}$/u.test(urlPath)) {
      const name = urlPath.slice(2);
      if (draftIndex?.names.has(name)) file = blobPath(options.root, name);
    }
    if (file === null) {
      return context.text('Not Found', 404);
    }

    // resolveFile returns a real path, which may be inside a fork's source
    // directory. URL resolution must instead follow the requested build path.
    const decodedPath = decodeURIComponent(urlPath);
    const relativePath = !decodedPath || decodedPath.endsWith('/') ? `${decodedPath}index.html` : decodedPath;
    const observeFrame = new URL(context.req.url).searchParams.get('frameObserver') === '2';
    if ((isPreview || observeFrame) && relativePath === 'index.html') {
      let html = await readFile(file, 'utf8').catch(() => null);
      if (html === null) return context.text('Not Found', 404);
      if (isPreview || isDraft) html = bootstrapPreviewHtml(html);
      if (observeFrame) html = observeFrameHtml(html);
      if (isDraft) html = scopeLegacyAssets(html, gameId, buildId, 'index.html', draftIndex?.source);
      else if (forkSource) html = scopeForkAssets(html, gameId, buildId, forkSource, false, true);
      context.header('content-type', 'text/html; charset=utf-8');
      return context.req.method === 'HEAD' ? context.body(null, 200) : context.body(html, 200);
    }
    if ((isDraft || !!forkSource) && /\.(?:html|js|mjs|css|json|svg)$/u.test(relativePath)) {
      const scope = `${gameId}\0${buildId}\0${relativePath}\0${draftIndex?.source?.gameId ?? ''}\0${draftIndex?.source?.buildId ?? ''}\0${isDraft}`;
      const roots = [
        `/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/`,
        ...(draftIndex?.source
          ? [`/g/${encodeURIComponent(draftIndex.source.gameId)}/${encodeURIComponent(draftIndex.source.buildId)}/`]
          : []),
      ];
      const rewrite = (text: string) =>
        isDraft
          ? scopeLegacyAssets(text, gameId, buildId, relativePath, draftIndex?.source, relativePath.endsWith('.css'))
          : forkSource
            ? scopeForkAssets(
                text,
                gameId,
                buildId,
                forkSource,
                relativePath.endsWith('.css'),
                /\.(?:html|svg)$/u.test(relativePath),
              )
            : text;
      const scan = relativePath === 'index.html' ? undefined : await scanLegacyText(file, scope, roots, rewrite);
      if (scan?.status === 'missing') return context.text('Not Found', 404);
      if (scan?.status === 'unchanged')
        return serveFile(context, file, { ETag: `"${buildId}:${encodeURIComponent(relativePath)}"` });
      if (scan?.status === 'rewritten') return serveTransformed(context, scan.text, mimeForPath(file));
      let text = await readFile(file, 'utf8').catch(() => null);
      if (text === null) return context.text('Not Found', 404);
      const original = text;
      if (relativePath === 'index.html' && isDraft) text = bootstrapPreviewHtml(text);
      text = rewrite(text);
      if (text === original) {
        return serveFile(context, file, { ETag: `"${buildId}:${encodeURIComponent(relativePath)}"` });
      }
      return serveTransformed(context, text, mimeForPath(file));
    }
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

    if (options.releaseGate && !(await options.authorize?.({ blob: file }).catch(() => false)))
      return context.text('Not Found', 404);
    return serveFile(context, path, { ETag: `"${file.slice(0, 64)}"` });
  };

  app.on(['GET', 'HEAD'], '/g/:gameId/:buildId', async (context) => {
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
    if (options.releaseGate && !(await options.authorize?.({ gameId, buildId }).catch(() => false)))
      return context.text('Not Found', 404);
    return context.redirect(`/g/${gameId}/${buildId}/`, 308);
  });
  app.on(['GET', 'HEAD'], '/g/:gameId/:buildId/*', serveGame);
  app.on(['GET', 'HEAD'], '/d/:gameId/:buildId/:grant/*', serveGame);
  app.on(['GET', 'HEAD'], '/p/:gameId/:buildId/*', serveGame);
  app.on(['GET', 'HEAD'], '/l/:gameId/:accessId', liveEntry(options.root, options.resolvePreview));
  app.on(['GET', 'HEAD'], '/l/:gameId/:accessId/', liveEntry(options.root, options.resolvePreview));
  app.on(['GET', 'HEAD'], '/l/:gameId/:accessId/:version/*', liveAsset(options.root, options.resolvePreview));
  app.on(['GET', 'HEAD'], '/a/:file', serveBlob);
  app.on(['GET', 'HEAD'], '/game-cache.js', (context) =>
    serveFile(context, options.workerScript, { 'Service-Worker-Allowed': '/g/' }),
  );

  app.notFound((context) => context.text('Not Found', 404, { 'Cache-Control': 'no-store' }));

  return app;
}

function serveTransformed(context: Context, text: string, contentType: string): Response {
  const headers = new Headers({ 'Content-Type': contentType, Vary: 'Accept-Encoding' });
  const encoding = preferredEncoding(context.req.header('Accept-Encoding'));
  if (encoding) headers.set('Content-Encoding', encoding);
  if (context.req.method === 'HEAD') return new Response(null, { headers });
  let body: Readable = Readable.from([Buffer.from(text)]);
  if (encoding === 'br') body = body.pipe(createBrotliCompress({ params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } }));
  else if (encoding === 'gzip') body = body.pipe(createGzip());
  return new Response(Readable.toWeb(body) as unknown as BodyInit, { headers });
}

function scopeLegacyAssets(
  text: string,
  gameId: string,
  buildId: string,
  file: string,
  source?: { gameId: string; buildId: string },
  css = false,
): string {
  const old = `/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/`;
  const sourcePath = source ? `/g/${encodeURIComponent(source.gameId)}/${encodeURIComponent(source.buildId)}/` : old;
  const relativeFile = (target: string) => {
    const path = posix.relative(posix.dirname(file), target);
    return path.startsWith('.') ? path : `./${path}`;
  };
  return rewriteRootReferences(
    text,
    (value, moduleRelative) => {
      if (value.startsWith(old) || value.startsWith(sourcePath)) {
        const target = value.slice(value.startsWith(old) ? old.length : sourcePath.length);
        return css || moduleRelative ? relativeFile(target) : `./${target}`;
      }
      return value.replace(/^\/a\/([0-9a-f]{64}\.[a-z0-9]{1,12})(?=$|[?#])/u, (_match, name: string) =>
        css || moduleRelative ? relativeFile(`a/${name}`) : `./a/${name}`,
      );
    },
    css,
    /\.(?:html|svg)$/u.test(file),
  );
}

function scopeForkAssets(
  text: string,
  gameId: string,
  buildId: string,
  source: { gameId: string; buildId: string },
  css = false,
  html = false,
): string {
  const from = `/g/${encodeURIComponent(source.gameId)}/${encodeURIComponent(source.buildId)}/`;
  const to = `/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/`;
  return rewriteRootReferences(
    text,
    (value) => (value.startsWith(from) ? to + value.slice(from.length) : value),
    css,
    html,
  );
}

// Preview access IDs are short-lived capabilities issued only by the authorized review API. Resolve every request
// against ticket and history records so answering or replacing a preview revokes its previous capability.
async function previewDirectory(root: string, gameId: string, accessId: string): Promise<string | null> {
  buildDir(root, gameId, 'preview-check');
  if (!/^pv-[0-9a-f-]{36}$/u.test(accessId)) return null;
  const directory = join(root, '.previews', gameId);
  const names = await readdir(directory).catch(() => [] as string[]);
  const historyDir = join(directory, '.history');
  const history = await readdir(historyDir).catch(() => [] as string[]);
  const files = [
    ...names.filter((entry) => /^[1-9]\d{0,15}\.json$/u.test(entry)).map((name) => join(directory, name)),
    ...history.filter((entry) => /^preview-[0-9a-f-]{36}\.json$/u.test(entry)).map((name) => join(historyDir, name)),
  ];
  for (const file of files) {
    const raw = await readFile(file, 'utf8').catch(() => '');
    let row: { gameId?: unknown; accessId?: unknown; accessExpiresAt?: unknown; buildId?: unknown; answered?: unknown };
    try {
      row = JSON.parse(raw) as typeof row;
    } catch {
      continue;
    }
    if (
      row.gameId !== gameId ||
      row.accessId !== accessId ||
      typeof row.answered !== 'boolean' ||
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
  if (mimeForPath(file) === 'video/mp4') {
    headers.set('Accept-Ranges', 'bytes');
    const range = context.req.method === 'GET' ? context.req.header('Range') : undefined;
    const ifRange = context.req.header('If-Range');
    if (range && (!ifRange || ifRange === headers.get('ETag'))) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        const suffix = !match[1];
        const start = suffix ? Math.max(0, fileStat.size - Number(match[2])) : Number(match[1]);
        const end = suffix || !match[2] ? fileStat.size - 1 : Math.min(Number(match[2]), fileStat.size - 1);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= fileStat.size) {
          headers.set('Content-Range', `bytes */${fileStat.size}`);
          return new Response(null, { headers, status: 416 });
        }
        headers.set('Content-Range', `bytes ${start}-${end}/${fileStat.size}`);
        headers.set('Content-Length', String(end - start + 1));
        const stream = createReadStream(file, { start, end });
        return new Response(Readable.toWeb(stream) as unknown as BodyInit, { headers, status: 206 });
      }
    }
  }
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
