import { copyFile, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { EFFEKSEER_WASM, effekseerRuntime } from '../../../scripts/effekseer-runtime.mjs';

const packageRoot = fileURLToPath(new URL('../../..', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('.', import.meta.url));
const effects = fileURLToPath(new URL('../../../../../skills/gm-vfx/effects', import.meta.url));
const outdir = `${packageRoot}/dist/vfx-fixture`;

await mkdir(`${outdir}/effects`, { recursive: true });
await build({
  absWorkingDir: packageRoot,
  entryPoints: ['src/vfx/fixture/main.ts'],
  entryNames: 'main',
  outdir,
  bundle: true,
  // Splitting keeps the runtime in its own chunk, so the spec can see it load only when effects start.
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  plugins: [effekseerRuntime],
  logLevel: 'info',
});
await copyFile(`${fixtureRoot}/index.html`, `${outdir}/index.html`);
await copyFile(EFFEKSEER_WASM, `${outdir}/effekseer.wasm`);
await cp(effects, `${outdir}/effects`, { recursive: true, filter: (path) => !path.endsWith('.efkproj') });
