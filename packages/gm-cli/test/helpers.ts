import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, type RunOptions } from '../src/cli.js';

const FIXTURE = fileURLToPath(new URL('../../asset-cards/test/fixtures/library', import.meta.url));

export function tempDir(prefix = 'gm-cli-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A writable copy of the asset-cards fixture library. */
export function library(): string {
  const root = tempDir('gm-lib-');
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}

export async function gm(
  argv: string[],
  options: RunOptions = {},
): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const cwd = options.cwd ?? tempDir();
  const env = options.env ?? {};
  const code = await run(argv, {
    ...options,
    cwd,
    /* Each test repo keeps its own asset cache unless the test names one, so tests never touch the host's shared cache. */
    env:
      'GM_ASSET_CACHE_DIR' in env || 'XDG_CACHE_HOME' in env
        ? env
        : { ...env, GM_ASSET_CACHE_DIR: join(cwd, '.gm/cache/assets') },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}
