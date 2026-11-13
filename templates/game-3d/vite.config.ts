import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { AssetsLockSchema } from '@ogm/contracts/assets';
import { sceneryPalette, type SceneryPaletteItem } from '@gm/sdk/scenery';

import { gmBuildArtifacts } from '@gm/sdk/vite';

import { manifest } from './src/manifest.js';

const lock = AssetsLockSchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('./assets.lock.json', import.meta.url)), 'utf8')),
);
const items: SceneryPaletteItem[] = lock.assets
  .filter((entry) => /\.(?:glb|gltf)$/i.test(entry.path))
  .map((entry) => {
    const name = (entry.id.split('/').at(-1) ?? entry.id).split('@')[0]!.replace(/[-_.]+/g, ' ');
    const category = /tree|bush|foliage/i.test(name)
      ? 'trees'
      : /rock|stone/i.test(name)
        ? 'rocks'
        : /water|stream|river/i.test(name)
          ? 'water'
          : 'props';
    return { assetId: entry.id, name, category };
  });
const palette = sceneryPalette(items, lock.assets);
const buildManifest = {
  ...manifest,
  palette,
  gizmos: {
    ...manifest.gizmos,
    ...Object.fromEntries(palette.items.map((item) => [item.prefab, ['translate', 'rotateYaw']])),
  },
} satisfies typeof manifest;

export default defineConfig(({ mode }) => ({
  define: {
    __GM_SCENERY_PALETTE__: JSON.stringify(palette),
    __GM_BUILD__: JSON.stringify(mode === 'published' ? 'published' : mode === 'test' ? 'test' : 'draft'),
  },
  resolve: {
    alias: {
      pixelfx: fileURLToPath(new URL('../../third_party/pixelfx/src', import.meta.url)),
    },
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
  preview: { host: '127.0.0.1', port: 43173 },
  build: { target: 'es2022' },
}));
