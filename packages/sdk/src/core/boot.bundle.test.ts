// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build as esbuild } from 'esbuild';
import { build as viteBuild, type Rolldown } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dist: string;

/** Stage one, as scripts/build.mjs ships the SDK: split ESM with __GM_BUILD__ left free. */
beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'gm-sdk-dist-'));
  await esbuild({
    entryPoints: { 'core/index': 'src/core/index.ts' },
    outdir: dist,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    packages: 'external',
    logLevel: 'silent',
  });
}, 60_000);

afterAll(() => rm(dist, { recursive: true, force: true }));

/** Stage two, as a template's vite build consumes that dist with __GM_BUILD__ defined. */
async function templateJs(kind: 'draft' | 'published'): Promise<string> {
  const result = (await viteBuild({
    configFile: false,
    logLevel: 'silent',
    root: dist,
    define: { __GM_BUILD__: JSON.stringify(kind) },
    build: {
      write: false,
      rolldownOptions: {
        input: join(dist, 'core/index.js'),
        preserveEntrySignatures: 'strict',
        external: (id) => !id.startsWith('.') && !id.startsWith('/'),
      },
    },
  })) as Rolldown.RolldownOutput;
  return result.output.map((file) => (file.type === 'chunk' ? file.code : '')).join('\n');
}

// C8: a published game must not ship the debug adapter at all, not just skip installing it.
describe('boot bundle', () => {
  it('keeps the debug adapter in a draft template build', async () => {
    const draft = await templateJs('draft');
    expect(draft).toContain('render_game_to_text');
    expect(draft).toContain('imageDraws');
  }, 60_000);

  it('leaves the debug adapter out of a published template build', async () => {
    const published = await templateJs('published');

    expect(published).not.toContain('render_game_to_text');
    expect(published).not.toMatch(/\b__gm\b/);
    expect(published).not.toContain('imageDraws');
  }, 60_000);
});
