import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

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
  const file = Object.keys(files).find((name) => pathname.startsWith('/g/') && pathname.endsWith(`/${name}`));
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': files[file],
  });
  response.end(await readFile(new URL(file, pathname.startsWith('/g/g_fall') ? fallFixture : fixture)));
}).listen(port, host, () => {
  process.stdout.write(`bridge fixture listening on http://${host}:${port}\n`);
});
