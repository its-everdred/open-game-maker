import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, sep } from 'node:path';
import { pipeline } from 'node:stream';

import { gameHeaders } from '@ogm/contracts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

/** Any local shell may frame a local game; every other header matches the games host. */
export const LOCAL_GAME_HEADERS = gameHeaders('http://127.0.0.1:*');

/**
 * A static file server for a built game on `127.0.0.1` and an ephemeral port; never serves outside `dir`. It also
 * answers the games host's `/g/<gameId>/<buildId>/<file>` paths with `<file>`, so the host frame mounts the build.
 * With `game`, every response carries the games host's headers (its CSP included), so a capture sees what prod allows.
 */
export async function serveStatic(
  dir: string,
  options: { game?: boolean } = {},
): Promise<{ url: string; close(): Promise<void> }> {
  const root = realpathSync(dir);
  const headers = options.game ? LOCAL_GAME_HEADERS : {};
  const server = createServer((req, res) => {
    let path: string;
    /* The games host's offline cache worker, which every build registers; a local capture caches nothing. */
    if (
      new URL(req.url ?? '/', 'http://127.0.0.1').pathname === '/game-cache.js' &&
      !existsSync(join(root, 'game-cache.js'))
    ) {
      res.writeHead(200, { ...headers, 'content-type': 'text/javascript' }).end('');
      return;
    }
    try {
      const requested = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      const pathname = requested.replace(/^\/g\/[^/]+\/[^/]+\//, '/');
      path = realpathSync(join(root, pathname));
      if (statSync(path).isDirectory()) path = realpathSync(join(path, 'index.html'));
    } catch {
      res.writeHead(404).end();
      return;
    }
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, {
      ...headers,
      'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    });
    /* an unreadable file must drop this response, not crash the runner */
    pipeline(createReadStream(path), res, () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** `gm run` only drives pages on this machine's loopback (T11). */
export function isLoopbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
}
