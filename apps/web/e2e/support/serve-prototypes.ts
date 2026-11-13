import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

// eslint-disable-next-line no-restricted-properties
const port = Number.parseInt(process.env.OGM_PROTOTYPE_E2E_PORT ?? '43176', 10);
const repo = resolve(import.meta.dirname, '../../../..');
const roots = {
  studio: 'prototypes/studio-v0',
  ui: 'prototypes/ui-v0/site',
} as const;
const tracked = new Set(
  execFileSync('git', ['ls-files', roots.studio, roots.ui], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean),
);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('ok');
    return;
  }

  const match = /^\/(studio|ui)(?:\/(.*))?$/.exec(url.pathname);
  if (!match) return notFound(response);
  const root = roots[match[1] as keyof typeof roots];
  let relative: string;
  try {
    relative = decodeURIComponent(match[2] || 'index.html');
  } catch {
    return notFound(response);
  }
  const repoRelative = `${root}/${relative}`;
  const file = resolve(repo, repoRelative);
  const rootPath = resolve(repo, root);
  if (!file.startsWith(`${rootPath}${sep}`) || !tracked.has(repoRelative)) return notFound(response);

  try {
    if (!statSync(file).isFile()) return notFound(response);
  } catch {
    return notFound(response);
  }
  response.writeHead(200, {
    'content-type': contentType(file),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(response);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `prototype reference port ${port} is already in use` : error);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1');

function notFound(response: import('node:http').ServerResponse) {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
}

function contentType(file: string): string {
  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.ico': 'image/x-icon',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.webmanifest': 'application/manifest+json',
    }[extname(file)] ?? 'application/octet-stream'
  );
}
