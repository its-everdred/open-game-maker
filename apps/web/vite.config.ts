import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';

// OGM_API_PORT is a local developer override; production requests stay same-origin.
// eslint-disable-next-line no-restricted-properties
const apiPort = process.env.OGM_API_PORT ?? '8787';
const apiTarget = `http://127.0.0.1:${apiPort}`;

// The frozen prototype remains the source of its showcase renderer. Vite
// bundles it for the app while the images stay at their public app paths.
function showcaseScenes(): Plugin {
  const id = '\0virtual:showcase-scenes';
  return {
    name: 'ogm-showcase-scenes',
    resolveId: (source) => (source === 'virtual:showcase-scenes' ? id : undefined),
    async load(source) {
      if (source !== id) return undefined;
      const scenes = await readFile(resolve(import.meta.dirname, '../../prototypes/studio-v0/scenes.js'), 'utf8');
      if (!scenes.includes('im.src = src;')) throw new Error('prototype scene asset URL pattern was not found');
      return scenes.replace('im.src = src;', "im.src = '/proto/' + src;");
    },
  };
}

// The title town decompresses its own .gz files (models.bin.gz); Vite's static server would add Content-Encoding: gzip
// and the browser would decompress them first. Serve them as plain bytes, as Netlify does.
function rawTownGzip(): Plugin {
  const serve =
    (root: string): Connect.NextHandleFunction =>
    (req, res, next) => {
      const path = decodeURIComponent((req.url ?? '').split('?')[0]!);
      const file = resolve(root, `.${path}`);
      if (!path.startsWith('/town/') || !path.endsWith('.gz') || !file.startsWith(root + sep)) return next();
      readFile(file).then(
        (body) => {
          res.setHeader('Content-Type', 'application/gzip');
          res.end(body);
        },
        () => next(),
      );
    };
  return {
    name: 'ogm-raw-town-gzip',
    configureServer: (server) => void server.middlewares.use(serve(server.config.publicDir)),
    configurePreviewServer: (server) =>
      void server.middlewares.use(serve(resolve(server.config.root, server.config.build.outDir))),
  };
}

export default defineConfig({
  plugins: [react(), rawTownGzip(), showcaseScenes()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/auth': apiTarget,
    },
  },
  build: {
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'e2e/**/*.test.ts'],
    setupFiles: './src/test/setup.ts',
  },
});
