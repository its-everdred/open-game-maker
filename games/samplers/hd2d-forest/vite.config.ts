import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  // Licensed media stays local: only draft and test builds copy public/assets-local or load it.
  const local = mode === 'draft' || mode === 'test';
  return {
    define: {
      __GM_PRIVATE_ASSETS__: JSON.stringify(local && existsSync(resolve('public/assets-local/manifest.json'))),
    },
    base: './',
    publicDir: local ? 'public' : false,
    server: { host: '127.0.0.1' },
    preview: { host: '127.0.0.1' },
  };
});
