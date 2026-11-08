// Bundles `gm run`'s host frame (shell/) into dist/shell: @gm/host and the app's stylesheets go in, so a game repo
// running gm run needs neither the app nor its sources.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'shell');
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, 'shell', 'host-shell.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: join(out, 'host-shell.js'),
  logLevel: 'warning',
});
copyFileSync(join(root, 'shell', 'host-shell.html'), join(out, 'host-shell.html'));
