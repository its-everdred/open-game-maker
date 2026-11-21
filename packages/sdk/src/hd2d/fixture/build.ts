import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = fileURLToPath(new URL('../../..', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('.', import.meta.url));
const outdir = `${packageRoot}/dist/hd2d-fixture`;

await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: packageRoot,
  entryPoints: ['src/hd2d/fixture/main.ts'],
  entryNames: 'main',
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'info',
});
await copyFile(`${fixtureRoot}/index.html`, `${outdir}/index.html`);
