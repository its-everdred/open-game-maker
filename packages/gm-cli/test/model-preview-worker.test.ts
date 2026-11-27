import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { ModelSourceMismatch, runPreviewWorker } from '../src/packs/model-preview.js';

async function buildWorker(root: string): Promise<string> {
  const worker = join(root, 'worker.mjs');
  await symlink(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir');
  execFileSync(join(process.cwd(), 'node_modules/.bin/esbuild'), [
    'src/packs/model-preview-worker.ts',
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--packages=external',
    `--outfile=${worker}`,
  ]);
  return worker;
}

it('verifies source bytes before using a cached preview', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gm-preview-hash-'));
  const worker = await buildWorker(root);
  const source = join(root, 'model.glb');
  await writeFile(source, 'model bytes');
  const hash = createHash('sha256').update('model bytes').digest('hex');
  await expect(runPreviewWorker(worker, [source, 'unused', root, 'true', hash, 'true'], 30_000)).resolves.toBe(
    'cached',
  );
  await expect(
    runPreviewWorker(worker, [source, 'unused', root, 'true', 'bad-hash', 'true'], 30_000),
  ).rejects.toBeInstanceOf(ModelSourceMismatch);
}, 90_000);

it.skipIf(process.platform !== 'linux')(
  'bounds a blocked source open in the worker',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'gm-preview-fifo-'));
    const worker = await buildWorker(root);
    const source = join(root, 'model.glb');
    execFileSync('mkfifo', [source]);
    await expect(runPreviewWorker(worker, [source, 'unused', root, 'true', 'hash', 'true'], 10_000)).rejects.toThrow(
      'preview timed out',
    );
  },
  45_000,
);

it.skipIf(process.env.GM_PREVIEWS_BROWSER !== '1')(
  'renders through the guarded Chromium worker',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'gm-preview-render-'));
    const worker = await buildWorker(root);
    const source = join(root, 'model.glb');
    const document = new Document();
    const buffer = document.createBuffer();
    const positions = document
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]))
      .setBuffer(buffer);
    const primitive = document.createPrimitive().setAttribute('POSITION', positions);
    document.createScene().addChild(document.createNode().setMesh(document.createMesh().addPrimitive(primitive)));
    await new NodeIO().write(source, document);
    const hash = createHash('sha256')
      .update(await readFile(source))
      .digest('hex');
    const renderer = await runPreviewWorker(
      worker,
      [source, join(root, 'previews/model.webp'), root, 'true', hash, 'false'],
      120_000,
    );
    expect(renderer.length).toBeGreaterThan(0);
    expect((await readFile(join(root, 'previews/model.webp'))).length).toBeGreaterThan(0);
  },
  150_000,
);

it.skipIf(process.env.GM_PREVIEWS_BROWSER !== '1')(
  'removes the Playwright profile after a worker timeout',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'gm-preview-profile-'));
    await symlink(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir');
    const worker = join(root, 'profile.mjs');
    const marker = join(root, 'profile.json');
    const playwright = pathToFileURL(join(process.cwd(), '../asset-previews/node_modules/playwright/index.mjs')).href;
    await writeFile(
      worker,
      `import { chromium } from ${JSON.stringify(playwright)};
import { readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], env: { HOME: tmpdir(), TMPDIR: '/tmp', PATH: '/usr/bin:/bin' } });
writeFileSync(process.argv[2], JSON.stringify({ runtime: tmpdir(), profile: readdirSync(tmpdir()).some(name => name.startsWith('playwright_')) }));
setInterval(() => {}, 1000);
`,
    );
    await expect(runPreviewWorker(worker, [marker], 30_000)).rejects.toThrow('preview timed out');
    const record = JSON.parse(await readFile(marker, 'utf8')) as { runtime: string; profile: boolean };
    expect(record.profile).toBe(true);
    await expect(stat(record.runtime)).rejects.toMatchObject({ code: 'ENOENT' });
  },
  90_000,
);
