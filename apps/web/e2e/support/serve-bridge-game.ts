import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

import { servePrototype } from './serve-prototypes.ts';

const host = '127.0.0.1';
// eslint-disable-next-line no-restricted-properties
const port = Number.parseInt(process.env.OGM_WEB_BRIDGE_PORT ?? '10001', 10);
const fixture = new URL('../fixtures/bridge-game/', import.meta.url);
/* The review deck's playable cards (#608) play a falling-blocks slice; its game ids start `g_fall`. */
const fallFixture = new URL('../fixtures/fall-game/', import.meta.url);
/* A build dir as the publisher stages it: the page plus its manifest and folded design. */
const files: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'manifest.json': 'application/json; charset=utf-8',
  'design/design.json': 'application/json; charset=utf-8',
};

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${host}:${port}`).pathname;
  if (pathname === '/health') {
    response.writeHead(204).end();
    return;
  }
  /* The app proxies /api here in e2e. A launch sends the frame to the build, as the API's redirect does. It navigates
     in the page rather than with a 302 because Playwright routes miss a redirect's target, and specs route builds.
     A navigation an opaque frame starts carries no referrer, so the build gets the shell's origin, which a 302 would
     have kept as its referrer, in `e2eHost`. */
  const launch = /^\/api\/v1\/games\/([^/]+)\/launch\/([^/]+)$/u.exec(pathname);
  if (launch) {
    const target = new URL(`/g/${launch[1]}/${launch[2]}/index.html`, `http://${host}:${port}`);
    target.search = new URL(request.url ?? '/', target).search;
    if (request.headers.referer) target.searchParams.set('e2eHost', new URL(request.headers.referer).origin);
    response
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .end(`<script>location.replace(${JSON.stringify(target.href)})</script>`);
    return;
  }
  if (pathname === '/studio' || pathname.startsWith('/studio/') || pathname === '/ui' || pathname.startsWith('/ui/')) {
    servePrototype(request, response);
    return;
  }
  const file = Object.keys(files).find((name) => pathname.startsWith('/g/') && pathname.endsWith(`/${name}`));
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  response.writeHead(200, {
    /* Launched games run as opaque documents, so their own fetches arrive from origin null. */
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': files[file],
  });
  response.end(await readFile(new URL(file, pathname.startsWith('/g/g_fall') ? fallFixture : fixture)));
}).listen(port, host, () => {
  process.stdout.write(`bridge fixture listening on http://${host}:${port}\n`);
});
