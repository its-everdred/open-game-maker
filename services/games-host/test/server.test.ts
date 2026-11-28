import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, gunzipSync } from 'node:zlib';
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/index.js';
import { markComplete } from '../src/layout.js';
import { createApp } from '../src/server.js';

describe('games-host server', () => {
  const blobSha = 'a'.repeat(64);
  let root: string;
  let build: string;
  let workerScript: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ogm-games-server-'));
    build = join(root, 'demo', 'b1');
    await mkdir(join(build, 'assets'), { recursive: true });
    await writeFile(join(build, 'index.html'), '<h1>demo</h1>');
    await writeFile(join(build, 'game.js'), 'globalThis.demo = "compress me";\n'.repeat(20));
    await writeFile(join(build, 'assets', 'x.webp'), 'webp');
    await writeFile(join(build, 'assets', 'payload.bin'), 'opaque');
    await mkdir(join(root, '_a'));
    await writeFile(join(root, '_a', `${blobSha}.webp`), 'shared-webp');
    workerScript = join(root, 'game-cache.js');
    await writeFile(workerScript, 'self.addEventListener("fetch", () => undefined);\n');
    await markComplete(build);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function app() {
    return createApp({
      root,
      appOrigin: 'https://makeopen.games',
      version: '0123456789abcdef0123456789abcdef01234567',
      uptimeSec: () => 12.9,
      workerScript,
      authorize: async () => true,
    });
  }

  it('fails closed and rechecks draft grants on every request', async () => {
    let allowed = true;
    const host = createApp({
      root,
      appOrigin: 'https://app.example.test',
      version: 'test',
      workerScript,
      authorize: async ({ grant }) => Boolean(grant && allowed),
    });
    const token = 'a'.repeat(43);
    expect((await host.request('/g/demo/b1/')).status).toBe(404);
    expect((await host.request(`/a/${blobSha}.webp`)).status).toBe(404);
    const draft = await host.request(`/d/demo/b1/${token}/`);
    expect(draft.status).toBe(200);
    expect(draft.headers.get('content-security-policy')).toContain('sandbox allow-scripts allow-pointer-lock');
    allowed = false;
    expect((await host.request(`/d/demo/b1/${token}/game.js`)).status).toBe(404);
    const unavailable = createApp({ root, appOrigin: 'https://app.example.test', version: 'test', workerScript });
    expect((await unavailable.request('/g/demo/b1/')).status).toBe(404);
  });

  it('streams a complete build with the game header contract', async () => {
    const response = await app().request('/g/demo/b1/');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors https://makeopen.games');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength('<h1>demo</h1>')));
    expect(await response.text()).toBe('<h1>demo</h1>');
  });

  it('redirects a published build entry document to its stable shared content URL', async () => {
    const content = '<!doctype html><h1>shared</h1>';
    const hash = createHash('sha256').update(content).digest('hex');
    await writeFile(join(root, '_a', `${hash}.html`), content);
    await writeFile(
      join(build, 'assets', 'cache-plan.json'),
      JSON.stringify({
        version: 1,
        gameId: 'demo',
        buildId: 'b1',
        built: '2026-11-01T00:00:00.000Z',
        sdkVersion: '1',
        tiers: ['desktop'],
        entries: [
          {
            sha256: hash,
            url: `/a/${hash}.html`,
            sourcePath: 'index.html',
            bytes: Buffer.byteLength(content),
            kind: 'code',
            phase: 'boot',
            tiers: ['*'],
          },
        ],
        totals: {
          desktop: {
            boot: { bytes: Buffer.byteLength(content), files: 1 },
            ready: { bytes: 0, files: 0 },
            stream: { bytes: 0, files: 0 },
          },
          mobile: { boot: { bytes: 0, files: 0 }, ready: { bytes: 0, files: 0 }, stream: { bytes: 0, files: 0 } },
          low: { boot: { bytes: 0, files: 0 }, ready: { bytes: 0, files: 0 }, stream: { bytes: 0, files: 0 } },
        },
      }),
    );
    const entry = await app().request('/g/demo/b1/');
    expect(entry.status).toBe(308);
    expect(entry.headers.get('location')).toBe(`/a/${hash}.html`);
    const shared = await app().request(`/a/${hash}.html`);
    expect(shared.headers.get('cache-control')).toBe('no-store');
    expect(await shared.text()).toBe('<!doctype html><h1>shared</h1>');
  });

  it('installs the versioned frame observer before game scripts only when requested', async () => {
    await writeFile(join(build, 'index.html'), '<!doctype html><script src="game.js"></script>');
    const response = await app().request('/g/demo/b1/index.html?frameObserver=2');
    const html = await response.text();
    expect(html).toContain('__ogm_frame_observer_v2.js');
    expect(html.indexOf('__ogm_frame_observer_v2.js')).toBeLessThan(html.indexOf('game.js'));
    const observer = await app().request('/g/demo/b1/__ogm_frame_observer_v2.js');
    expect(observer.headers.get('content-type')).toContain('text/javascript');
    expect(await observer.text()).toContain('gm-frame-ready');
    const ordinary = await app().request('/g/demo/b1/index.html');
    expect(await ordinary.text()).not.toContain('__ogm_frame_observer_v2.js');
  });

  it('redirects a build root without a trailing slash so relative URLs stay inside the build', async () => {
    const response = await app().request('/g/demo/b1');

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/g/demo/b1/');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('serves assets and applies nosniff to unknown extensions', async () => {
    const image = await app().request('/g/demo/b1/assets/x.webp');
    const unknown = await app().request('/g/demo/b1/assets/payload.bin');

    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/webp');
    expect(image.headers.get('permissions-policy')).toBe('microphone=(self), camera=(), geolocation=(), payment=()');
    expect(await image.text()).toBe('webp');
    expect(unknown.status).toBe(200);
    expect(unknown.headers.get('content-type')).toBe('application/octet-stream');
    expect(unknown.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves AVIF display images with immutable caching', async () => {
    await writeFile(join(build, 'assets', 'image.avif'), 'avif');
    const response = await app().request('/g/demo/b1/assets/image.avif');
    expect(response.headers.get('content-type')).toBe('image/avif');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('serves gameplay trailers as MP4 video', async () => {
    await writeFile(join(build, 'trailer.mp4'), 'video');
    const response = await app().request('/g/demo/b1/trailer.mp4');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(await response.text()).toBe('video');
    const partial = await app().request('/g/demo/b1/trailer.mp4', { headers: { Range: 'bytes=1-3' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 1-3/5');
    expect(await partial.text()).toBe('ide');
    const suffix = await app().request('/g/demo/b1/trailer.mp4', { headers: { Range: 'bytes=-2' } });
    expect(await suffix.text()).toBe('eo');
    const invalid = await app().request('/g/demo/b1/trailer.mp4', { headers: { Range: 'bytes=10-' } });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe('bytes */5');
  });

  it('returns headers without a body for HEAD', async () => {
    const response = await app().request('/g/demo/b1/index.html', { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength('<h1>demo</h1>')));
    expect(await response.text()).toBe('');
  });

  it('serves a shared blob with immutable headers and its sha ETag', async () => {
    const response = await app().request(`/a/${blobSha}.webp`);
    const headResponse = await app().request(`/a/${blobSha}.webp`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('etag')).toBe(`"${blobSha}"`);
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(await response.text()).toBe('shared-webp');
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get('etag')).toBe(`"${blobSha}"`);
    expect(await headResponse.text()).toBe('');
  });

  it.each([`${'a'.repeat(63)}.webp`, `${'A'.repeat(64)}.webp`, `${'a'.repeat(64)}.svg`, `../${blobSha}.webp`])(
    'returns no-store 404 for invalid blob name %s',
    async (file) => {
      const response = await app().request(`/a/${file}`);

      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );

  it('serves the cache worker without caching it', async () => {
    const response = await app().request('/game-cache.js');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('service-worker-allowed')).toBe('/g/');
    expect(await response.text()).toContain('addEventListener');
  });

  it('compresses text with Brotli while leaving media uncompressed', async () => {
    const script = await app().request('/g/demo/b1/game.js', { headers: { 'Accept-Encoding': 'br' } });
    const image = await app().request('/g/demo/b1/assets/x.webp', { headers: { 'Accept-Encoding': 'br' } });

    expect(script.headers.get('content-encoding')).toBe('br');
    expect(script.headers.get('vary')).toBe('Accept-Encoding');
    expect(brotliDecompressSync(Buffer.from(await script.arrayBuffer())).toString()).toBe(
      'globalThis.demo = "compress me";\n'.repeat(20),
    );
    expect(image.headers.has('content-encoding')).toBe(false);
    expect(image.headers.has('vary')).toBe(false);
    expect(await image.text()).toBe('webp');
  });

  it('streams precompressed modern draft scripts and compresses rewritten legacy scripts', async () => {
    const token = 'a'.repeat(43);
    const phases = () => ({
      boot: { bytes: 0, files: 0 },
      ready: { bytes: 0, files: 0 },
      stream: { bytes: 0, files: 0 },
    });
    await writeFile(
      join(build, 'assets/cache-plan.json'),
      JSON.stringify({
        version: 1,
        gameId: 'demo',
        buildId: 'b1',
        built: '2026-11-01T00:00:00.000Z',
        sdkVersion: '1',
        tiers: ['desktop'],
        entries: [],
        totals: { desktop: phases(), mobile: phases(), low: phases() },
      }),
    );
    await writeFile(join(build, 'game.js.br'), brotliCompressSync('precompressed draft'));
    const modern = await app().request(`/d/demo/b1/${token}/game.js`, { headers: { 'Accept-Encoding': 'br' } });
    expect(modern.headers.get('content-encoding')).toBe('br');
    expect(brotliDecompressSync(Buffer.from(await modern.arrayBuffer())).toString()).toBe('precompressed draft');
    await unlink(join(build, 'assets/cache-plan.json'));
    await writeFile(join(build, 'game.js'), 'import "/g/demo/b1/other.js"');
    const legacy = await app().request(`/d/demo/b1/${token}/game.js`, { headers: { 'Accept-Encoding': 'br' } });
    expect(legacy.headers.get('content-encoding')).toBe('br');
    expect(brotliDecompressSync(Buffer.from(await legacy.arrayBuffer())).toString()).toContain('./other.js');
  });

  it('scopes only root-relative references and serves private build assets', async () => {
    const token = 'z'.repeat(43);
    const name = `${blobSha}.webp`;
    await mkdir(join(build, 'a'));
    await writeFile(join(build, 'a', name), 'private');
    await writeFile(join(build, 'index.html'), `<img src=https://cdn.example/url(/a/${name})>`);
    await writeFile(
      join(build, 'game.js'),
      `fetch('/g/demo/b1/a/${name}'); fetch('/a/${name}'); fetch(new URL('/a/${name}', 'https://cdn.example')); fetch('https://cdn.example/a/${name}'); fetch('//cdn.example/g/demo/b1/a/${name}'); fetch('https://cdn.example/foo( /a/${name})'); fetch('https://cdn.example/foo(/g/demo/b1/a/${name})');`,
    );
    const text = await (await app().request(`/d/demo/b1/${token}/game.js`)).text();
    expect(text).toContain(`fetch('./a/${name}')`);
    expect(text).toContain(`new URL('./a/${name}', 'https://cdn.example')`);
    expect(text).toContain(`https://cdn.example/a/${name}`);
    expect(text).toContain(`//cdn.example/g/demo/b1/a/${name}`);
    expect(text).toContain(`https://cdn.example/foo( /a/${name})`);
    expect(text).toContain(`https://cdn.example/foo(/g/demo/b1/a/${name})`);
    expect(text).not.toContain(`cdn.example/d/`);
    expect(text).not.toContain(token);
    const html = await (await app().request(`/d/demo/b1/${token}/index.html`)).text();
    expect(html).toContain(`src=https://cdn.example/url(/a/${name})`);
    expect(html).not.toContain(token);
    expect(await (await app().request(`/d/demo/b1/${token}/a/${name}`)).text()).toBe('private');
  });

  it('invalidates a cached unchanged scan when the build file is replaced', async () => {
    const token = 'z'.repeat(43);
    const script = join(build, 'game.js');
    await writeFile(script, `fetch('https://cdn.example/a/${blobSha}.webp')`);
    const first = await (await app().request(`/d/demo/b1/${token}/game.js`)).text();
    expect(first).toContain(`https://cdn.example/a/${blobSha}.webp`);
    await writeFile(script, `fetch('/a/${blobSha}.webp')`);
    const changed = await (await app().request(`/d/demo/b1/${token}/game.js`)).text();
    expect(changed).toContain(`fetch('./a/${blobSha}.webp')`);
  });

  it('resolves nested module imports, runtime fetches, CSS and unquoted HTML with an empty plan', async () => {
    const token = 'z'.repeat(43);
    const name = `${blobSha}.webp`;
    const phases = () => ({
      boot: { bytes: 0, files: 0 },
      ready: { bytes: 0, files: 0 },
      stream: { bytes: 0, files: 0 },
    });
    await writeFile(
      join(build, 'assets/cache-plan.json'),
      JSON.stringify({
        version: 1,
        gameId: 'demo',
        buildId: 'b1',
        built: '2026-11-01T00:00:00.000Z',
        sdkVersion: '1',
        tiers: ['desktop'],
        entries: [],
        totals: { desktop: phases(), mobile: phases(), low: phases() },
      }),
    );
    await writeFile(
      join(build, 'index.html'),
      `<style>body{background:url(/a/${name})}</style><script src=/g/demo/b1/assets/main.js></script><img style="background:url(/a/${name})" src=https://cdn.example/url(/a/${name})>`,
    );
    await writeFile(
      join(build, 'assets/main.js'),
      `// don't confuse comment quotes\nimport '/g/demo/b1/game.js'; fetch('/g/demo/b1/data.json'); import('/a/${blobSha}.js'); new URL('/a/${name}', import.meta.url);`,
    );
    await writeFile(join(build, 'assets/game.css'), `a{background:url(/a/${name})}`);
    const html = await (await app().request(`/d/demo/b1/${token}/`)).text();
    expect(html).toContain('src=./assets/main.js');
    expect(html).toContain(`src=https://cdn.example/url(/a/${name})`);
    expect(html).toContain(`background:url(./a/${name})`);
    const script = await (await app().request(`/d/demo/b1/${token}/assets/main.js`)).text();
    expect(script).toContain("import '../game.js'");
    expect(script).toContain("fetch('./data.json')");
    expect(script).toContain(`import('../a/${blobSha}.js')`);
    expect(script).toContain(`new URL('../a/${name}', import.meta.url)`);
    expect(await (await app().request(`/d/demo/b1/${token}/assets/game.css`)).text()).toContain(`url(../a/${name})`);
    expect(script).not.toContain(token);
  });

  it('serves a fork of a legacy build using its source plan and scoped URLs', async () => {
    const phases = () => ({
      boot: { bytes: 0, files: 0 },
      ready: { bytes: 0, files: 0 },
      stream: { bytes: 0, files: 0 },
    });
    await writeFile(
      join(build, 'assets/cache-plan.json'),
      JSON.stringify({
        version: 1,
        gameId: 'demo',
        buildId: 'b1',
        built: '2026-11-01T00:00:00.000Z',
        sdkVersion: '1',
        tiers: ['desktop'],
        entries: [
          { sha256: blobSha, url: `/a/${blobSha}.webp`, bytes: 1, kind: 'sprite', phase: 'boot', tiers: ['*'] },
        ],
        totals: { desktop: phases(), mobile: phases(), low: phases() },
      }),
    );
    await writeFile(join(build, 'game.js'), `import '/g/demo/b1/other.js'; fetch('/a/${blobSha}.webp');`);
    await writeFile(join(build, 'index.html'), '<script src=/g/demo/b1/game.js></script>');
    await mkdir(join(root, 'fork'));
    await symlink(build, join(root, 'fork', 'b2'), 'dir');
    const token = 'a'.repeat(43);
    const script = await (await app().request(`/d/fork/b2/${token}/game.js`)).text();
    expect(script).toContain('./other.js');
    expect(script).toContain(`./a/${blobSha}.webp`);
    expect(await (await app().request(`/d/fork/b2/${token}/a/${blobSha}.webp`)).text()).toBe('shared-webp');
    expect(await (await app().request('/g/fork/b2/game.js')).text()).toContain('/g/fork/b2/other.js');
    expect(await (await app().request('/g/fork/b2/')).text()).toContain('src=/g/fork/b2/game.js');
  });

  it('serves a precompressed Brotli file when one is present', async () => {
    const encoded = brotliCompressSync('precompressed body');
    await writeFile(join(build, 'pre.js'), 'uncompressed body');
    await writeFile(join(build, 'pre.js.br'), encoded);

    const response = await app().request('/g/demo/b1/pre.js', { headers: { 'Accept-Encoding': 'br' } });

    expect(response.headers.get('content-encoding')).toBe('br');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(encoded);
  });

  it('compresses text with gzip when Brotli is unavailable to the client', async () => {
    const response = await app().request('/g/demo/b1/game.js', { headers: { 'Accept-Encoding': 'gzip' } });

    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(
      'globalThis.demo = "compress me";\n'.repeat(20),
    );
  });

  it('does not set cookies when the request carries one', async () => {
    const response = await app().request('/g/demo/b1/', { headers: { Cookie: 'session=secret' } });

    expect(response.status).toBe(200);
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('strips a Set-Cookie header from every game response', async () => {
    const application = app();
    application.get('/g/cookie-probe', (context) => {
      context.header('Set-Cookie', 'probe=1');
      return context.text('ok');
    });

    const response = await application.request('/g/cookie-probe');

    expect(response.status).toBe(200);
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('hides incomplete builds while preserving game security headers', async () => {
    await unlink(join(build, '.complete'));

    const response = await app().request('/g/demo/b1/');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');

    await markComplete(build);
    const completed = await app().request('/g/demo/b1/');
    expect(completed.status).toBe(200);
    expect(completed.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    '/g/Demo/b1/',
    '/g/demo/Demo/',
    `/g/${'a'.repeat(65)}/b1/`,
    '/g/demo/b1/%2e%2e/index.html',
    '/g/demo/b1/assets/%2e%2e/%2e%2e/index.html',
    '/g/demo/b1/assets/',
  ])('returns 404 for invalid or unsafe path %s', async (path) => {
    const response = await app().request(path);

    expect(response.status).toBe(404);
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('returns the health contract without caching it', async () => {
    const response = await app().request('/healthz');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'games-host',
      version: '0123456789abcdef0123456789abcdef01234567',
      uptimeSec: 12,
    });
  });

  it('refuses a non-loopback bind address', () => {
    expect(() =>
      main({
        OGM_GAMES_BIND: '0.0.0.0',
        OGM_GAMES_PORT: '3400',
        OGM_GAMES_ROOT: root,
        OGM_APP_ORIGIN: 'https://makeopen.games',
      }),
    ).toThrow('OGM_GAMES_BIND must be 127.0.0.1');
  });

  it('reports an occupied port as a startup failure without logging environment values', async () => {
    const blocker = createServer();
    blocker.listen(0, '127.0.0.1');
    await once(blocker, 'listening');
    const address = blocker.address();
    if (address === null || typeof address === 'string') {
      throw new Error('port blocker did not bind a TCP port');
    }

    const originalExitCode = process.exitCode;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const server = main({
        OGM_GAMES_PORT: String(address.port),
        OGM_GAMES_ROOT: root,
        OGM_APP_ORIGIN: 'https://makeopen.games',
      });

      await once(server, 'error');

      expect(process.exitCode).toBe(1);
      expect(errorLog).toHaveBeenCalledWith(JSON.stringify({ event: 'server-error', service: 'games-host' }));
    } finally {
      process.exitCode = originalExitCode;
      errorLog.mockRestore();
      blocker.close();
      await once(blocker, 'close');
    }
  });
});
