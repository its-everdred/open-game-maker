import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  absWorkingDir: packageRoot,
  entryPoints: {
    index: 'src/index.ts',
    achievements: 'src/achievements.ts',
    analytics: 'src/analytics.ts',
    'assets/index': 'src/assets/index.ts',
    'audio/index': 'src/audio/index.ts',
    'camera/index': 'src/camera/index.ts',
    'core/index': 'src/core/index.ts',
    'fx/index': 'src/fx/index.ts',
    'input/index': 'src/input/index.ts',
    'nav/index': 'src/nav/index.ts',
    'phaser/index': 'src/phaser/index.ts',
    'proc/index': 'src/proc/index.ts',
    'saves/index': 'src/saves/index.ts',
    'scenery/index': 'src/scenery/index.ts',
    'test/index': 'src/test/index.ts',
    'three/index': 'src/three/index.ts',
  },
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  packages: 'external',
  alias: {
    pixelfx: resolve(packageRoot, '../../third_party/pixelfx/src'),
  },
  chunkNames: 'chunks/[name]-[hash]',
  logLevel: 'info',
});
