import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const templateRoots = new Map([
  ['game-2d', fileURLToPath(new URL('../../../templates/game-2d/dist/', import.meta.url))],
  ['game-3d', fileURLToPath(new URL('../../../templates/game-3d/dist/', import.meta.url))],
]);
const sharedBlobPath = `/a/${'a'.repeat(64)}.glb`;
const requestCounts = new Map<string, number>();

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}

async function file(response: ServerResponse, path: string, headers: Record<string, string> = {}): Promise<void> {
  const body = await readFile(path);
  response.writeHead(200, { 'content-type': contentType(path), ...headers });
  response.end(body);
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

const app = createServer(async (request, response) => {
  if (request.url === '/health') return response.end('ok');
  if (request.url === '/app.js') return file(response, `${root}/dist/test/app/main.js`);
  return html(
    response,
    '<!doctype html><meta charset="utf-8"><style>html,body,#game{margin:0;width:100%;height:100%}</style><div id="game"></div><script type="module" src="/app.js"></script>',
  );
});

const game = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1:4174').pathname;
  if (path === '/test/request-counts') {
    if (request.method === 'DELETE') requestCounts.clear();
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify(Object.fromEntries(requestCounts)));
  }
  if (path === sharedBlobPath || /^\/g\/cache-game\/[^/]+\/game\.js$/.test(path)) {
    requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
  }
  if (path === '/game.js') return file(response, `${root}/dist/test/stub-game/main.js`);
  if (path === '/d/fixture/draft-1/draft-token/index.html') {
    response.setHeader('Access-Control-Allow-Origin', '*');
    return html(
      response,
      '<!doctype html><div id="canvas">game canvas</div><script type="module" src="./game.js"></script><script>fetch("./asset.txt").then(r => r.text()).then(t => document.body.dataset.asset = t)</script>',
    );
  }
  if (path === '/d/fixture/draft-1/draft-token/game.js') {
    return file(response, `${root}/dist/test/stub-game/main.js`, {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
  }
  if (path === '/d/fixture/draft-1/draft-token/asset.txt') {
    response.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' });
    return response.end('scoped asset');
  }
  if (path === '/g/menu-game/draft-1/game.js') return file(response, `${root}/dist/test/menu-game/main.js`);
  if (path === '/g/menu-game/draft-1/index.html') {
    return html(
      response,
      '<!doctype html><meta charset="utf-8"><div id="title"><button id="settings">Settings</button><button id="play" data-gm-primary>Play</button></div><script type="module" src="./game.js"></script>',
    );
  }
  if (/^\/g\/[^/]+\/[^/]+\/game\.js$/.test(path)) {
    return file(response, `${root}/dist/test/stub-game/main.js`, { 'cache-control': 'no-store' });
  }
  if (path === '/game-cache.js') {
    return file(response, `${root}/dist/game-cache.js`, { 'service-worker-allowed': '/g/' });
  }
  if (path === '/forger.html') {
    return html(
      response,
      '<script>parent.postMessage(JSON.stringify({v:1,id:"forged",t:"ready",payload:{protocol:1,manifest:{},marks:[]}}),"http://127.0.0.1:4173")</script>',
    );
  }
  if (path === sharedBlobPath) {
    response.writeHead(200, { 'content-type': 'model/gltf-binary', 'cache-control': 'no-store' });
    return response.end('fixture-asset');
  }
  const templateMatch = /^\/g\/(game-[23]d)\/b1\/index\.html$/u.exec(path);
  if (templateMatch) {
    return file(response, `${templateRoots.get(templateMatch[1]!)}/index.html`);
  }
  if (path.startsWith('/assets/')) {
    for (const templateRoot of templateRoots.values()) {
      try {
        return await file(response, `${templateRoot}${path}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    response.writeHead(404);
    return response.end('not found');
  }
  return html(
    response,
    '<!doctype html><meta charset="utf-8"><style>#canvas{width:160px;height:160px;background:#123}</style><button id="relay">relay audio</button><div id="canvas">game canvas</div><div id="cache-result"></div><script>navigator.serviceWorker?.register("/game-cache.js",{scope:"/g/"}).catch(()=>undefined)</script><script type="module" src="./game.js"></script>',
  );
});

app.listen(4173, '127.0.0.1');
game.listen(4174, '127.0.0.1');

const close = () => {
  app.close();
  game.close();
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
