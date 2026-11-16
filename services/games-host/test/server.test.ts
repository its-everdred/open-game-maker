import { brotliCompressSync, brotliDecompressSync, gunzipSync } from 'node:zlib';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
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
    });
  }

  it('streams a complete build with the game header contract', async () => {
    const response = await app().request('/g/demo/b1/');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors https://makeopen.games');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength('<h1>demo</h1>')));
    expect(await response.text()).toBe('<h1>demo</h1>');
  });

  it('installs the versioned frame observer before game scripts only when requested', async () => {
    await writeFile(join(build, 'index.html'), '<!doctype html><script src="game.js"></script>');
    const response = await app().request('/g/demo/b1/index.html?frameObserver=1');
    const html = await response.text();
    expect(html).toContain('__ogm_frame_observer_v1.js');
    expect(html.indexOf('__ogm_frame_observer_v1.js')).toBeLessThan(html.indexOf('game.js'));
    const observer = await app().request('/g/demo/b1/__ogm_frame_observer_v1.js');
    expect(observer.headers.get('content-type')).toContain('text/javascript');
    expect(await observer.text()).toContain('gm-frame-ready');
    const ordinary = await app().request('/g/demo/b1/index.html');
    expect(await ordinary.text()).not.toContain('__ogm_frame_observer_v1.js');
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
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
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
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
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
    expect(completed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
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
