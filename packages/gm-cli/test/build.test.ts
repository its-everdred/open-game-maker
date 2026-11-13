import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

const manifest = {
  id: 'fixture',
  sdk: '*',
  title: 'Fixture',
  inputs: { actions: { jump: 'button' } },
  presentation: { orientation: 'landscape', minLogical: { w: 640, h: 480 }, fit: 'fixed' },
  view: 'side',
  dimension: '2d',
  capabilities: [],
  palette: { categories: [], items: [] },
  tools: ['select'],
  gizmos: {},
  saves: false,
  overrides: { aliases: {}, retired: [] },
};
const design = { schemaVersion: 1, globals: {}, entities: {} };

/** A game dir whose `pnpm build` writes the given files into dist/ (or exits 1 when `fail`). */
function game(files: Record<string, unknown>, fail = false, includePublishFiles = true): string {
  files = includePublishFiles
    ? { 'index.html': '<script src="./assets/main.js"></script>', 'credits.json': {}, ...files }
    : files;
  const cwd = tempDir('gm-build-');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'node build.mjs' } }));
  writeFileSync(
    join(cwd, 'build.mjs'),
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "mkdirSync('dist/design', { recursive: true });",
      ...Object.entries(files).map(
        ([file, value]) =>
          `writeFileSync('dist/${file}', ${JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value))});`,
      ),
      fail ? "console.error('bundle exploded'); process.exit(1);" : '',
    ].join('\n'),
  );
  return cwd;
}

/* The publisher refuses a build dir without a valid manifest and design, so gm build must catch it first. */
describe('gm build', () => {
  it('passes when the build leaves a valid manifest and design in dist/', async () => {
    const result = await gm(['build'], { cwd: game({ 'manifest.json': manifest, 'design/design.json': design }) });
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
  }, 60_000);

  it('rejects origin-root assets with the publish error', async () => {
    const cwd = game({
      'manifest.json': manifest,
      'design/design.json': design,
      'index.html': '<script src="/assets/main.js"></script>',
    });
    const result = await gm(['build'], { cwd });
    expect(result.code).toBe(1);
    expect(result.err).toContain('dist/index.html loads assets from the origin root; set a relative base');
  }, 60_000);

  it('fails naming the missing design file', async () => {
    const result = await gm(['build', '--json'], { cwd: game({ 'manifest.json': manifest }) });
    expect(result.code).toBe(1);
    const report = JSON.parse(result.out[0] ?? '') as { ok: boolean; problems: string[] };
    expect(report.ok).toBe(false);
    expect(report.problems).toHaveLength(2);
    expect(report.problems[0]).toMatch(/^dist\/design\/design\.json could not be read/);
  }, 60_000);

  it('fails when the manifest does not match the contracts schema', async () => {
    const broken: Partial<typeof manifest> = structuredClone(manifest);
    delete broken.dimension;
    const result = await gm(['build'], { cwd: game({ 'manifest.json': broken, 'design/design.json': design }) });
    expect(result.code).toBe(1);
    expect(result.err).toEqual([expect.stringMatching(/^dist\/manifest\.json is invalid at \/dimension/)]);
  }, 60_000);

  it('fails with the build output when pnpm build fails', async () => {
    const result = await gm(['build', '--json'], { cwd: game({}, true) });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('bundle exploded');
    expect(JSON.parse(result.out[0] ?? '')).toEqual({ ok: false, problems: ['pnpm build failed with exit 1'] });
  }, 60_000);

  it('rejects stale publish files when the new build omits them', async () => {
    const cwd = game({ 'manifest.json': manifest, 'design/design.json': design }, false, false);
    mkdirSync(join(cwd, 'dist'), { recursive: true });
    writeFileSync(join(cwd, 'dist', 'index.html'), '<script src="./assets/main.js"></script>');
    writeFileSync(join(cwd, 'dist', 'credits.json'), '{}');
    const result = await gm(['build'], { cwd });
    expect(result.code).toBe(1);
    expect(result.err).toEqual(['the build wrote no dist/index.html, dist/credits.json']);
  }, 60_000);

  it('does not pass on files an earlier build left in dist/', async () => {
    const cwd = game({}, false, false);
    mkdirSync(join(cwd, 'dist', 'design'), { recursive: true });
    writeFileSync(join(cwd, 'dist', 'index.html'), '<script src="./assets/main.js"></script>');
    writeFileSync(join(cwd, 'dist', 'credits.json'), '{}');
    writeFileSync(join(cwd, 'dist', 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(cwd, 'dist', 'design', 'design.json'), JSON.stringify(design));
    const result = await gm(['build'], { cwd });
    expect(result.code).toBe(1);
    expect(result.err).toHaveLength(3);
  }, 60_000);
});
