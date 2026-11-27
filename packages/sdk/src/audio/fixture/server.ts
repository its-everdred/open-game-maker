import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';

const dist = resolve(fileURLToPath(new URL('../../../dist', import.meta.url)));
const port = Number(env.SDK_AUDIO_TEST_PORT ?? 4181);
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.opus': 'audio/ogg; codecs=opus',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

const server = createServer(async (request, response) => {
  if (request.url === '/health') return response.end('ok');
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1:4181').pathname;
  const match = /^\/(audio|camera|hd2d|vfx)(\/.*)?$/.exec(pathname);
  if (!match) {
    response.writeHead(404);
    return response.end('not found');
  }
  const root = resolve(dist, `${match[1]}-fixture`);
  const relative = match[2] === undefined || match[2] === '/' ? '/index.html' : match[2];
  const filename = resolve(root, `.${relative}`);
  if (filename !== root && !filename.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    return response.end('forbidden');
  }
  try {
    const body = await readFile(filename);
    response.writeHead(200, { 'content-type': contentTypes[extname(filename)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});

server.listen(port, '127.0.0.1');
const close = () => server.close();
process.on('SIGINT', close);
process.on('SIGTERM', close);
