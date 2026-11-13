import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { AssetsLockSchema } from '@ogm/contracts/assets';

import { gmBuildArtifacts } from '@gm/sdk/vite';
import { defineConfig } from 'vite';

import { manifest } from './src/manifest.js';

const lock = AssetsLockSchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('./assets.lock.json', import.meta.url)), 'utf8')),
);
const sceneryItems = lock.assets
  .filter((asset) => /\.(png|jpe?g|webp)$/i.test(asset.path))
  .map((asset) => ({
    prefab: `scenery:${asset.id}`,
    label: asset.id.split('/').at(-1) ?? asset.id,
    category: 'sprites',
    assetSha: asset.sha256,
  }));
const buildManifest = {
  ...manifest,
  palette: {
    ...manifest.palette,
    items: [...manifest.palette.items.filter((item) => !item.prefab.startsWith('scenery:')), ...sceneryItems],
  },
  gizmos: {
    ...manifest.gizmos,
    ...Object.fromEntries(sceneryItems.map((item) => [item.prefab, ['translate' as const]])),
  },
};

export default defineConfig(({ mode }) => ({
  define: {
    __GM_BUILD__: JSON.stringify(mode === 'published' ? 'published' : mode === 'test' ? 'test' : 'draft'),
    __GM_SCENERY_ITEMS__: JSON.stringify(sceneryItems),
  },
  plugins: [
    gmBuildArtifacts({
      manifest: buildManifest,
      designDir: fileURLToPath(new URL('./design/', import.meta.url)),
      assetsLockFile: fileURLToPath(new URL('./assets.lock.json', import.meta.url)),
      creditsFile: fileURLToPath(new URL('./CREDITS.md', import.meta.url)),
    }),
  ],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
}));
