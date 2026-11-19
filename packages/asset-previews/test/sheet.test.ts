import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { afterEach, describe, expect, it } from 'vitest';

import { renderCollectionSheet, renderSheet, spriteSheet } from '../src/index.js';
import { previewContextStats } from '../src/browser.js';

const temporary: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'asset-previews-'));
  temporary.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function modelFixture(directory: string): Promise<string> {
  const path = join(directory, 'triangle.glb');
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = document
    .createAccessor('positions')
    .setType('VEC3')
    .setArray(new Float32Array([-0.7, -0.5, 0, 0.7, -0.5, 0, 0, 0.8, 0]))
    .setBuffer(buffer);
  const indices = document
    .createAccessor('indices')
    .setType('SCALAR')
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const material = document.createMaterial('orange').setBaseColorFactor([1, 0.35, 0.1, 1]).setDoubleSided(true);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', positions)
    .setIndices(indices)
    .setMaterial(material);
  const mesh = document.createMesh('triangle').addPrimitive(primitive);
  document.createScene('scene').addChild(document.createNode('triangle').setMesh(mesh));
  await new NodeIO().write(path, document);
  return path;
}

describe.skipIf(process.env.GM_PREVIEWS_BROWSER !== '1')('renderSheet', () => {
  it('renders six deterministic model views through the isolated local page', async () => {
    const directory = await workspace();
    const out = join(directory, 'model.webp');
    const result = await renderSheet(await modelFixture(directory), out, { executablePath: '/usr/bin/chromium' });
    const metadata = await sharp(out).metadata();
    expect(metadata.width).toBe(1152);
    expect(metadata.height).toBe(768);
    expect(result.views).toHaveLength(6);
    expect(result.renderer).not.toBe('');
    const pixels = await sharp(out).raw().toBuffer();
    expect(pixels.some((value, index) => value !== [154, 154, 154][index % 3])).toBe(true);
  }, 90_000);

  it('refuses external glTF resources', async () => {
    const directory = await workspace();
    const model = join(directory, 'external.gltf');
    await writeFile(
      model,
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'https://example.com/private.bin', byteLength: 36 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
            min: [0, 0, 0],
            max: [1, 1, 0],
          },
        ],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        nodes: [{ mesh: 0 }],
        scenes: [{ nodes: [0] }],
        scene: 0,
      }),
    );
    await expect(
      renderSheet(model, join(directory, 'should-not-exist.webp'), { executablePath: '/usr/bin/chromium' }),
    ).rejects.toThrow(/external glTF resources are refused|Failed to fetch|Could not load|preview request failed/);
  }, 90_000);

  it('renders through the explicit software fallback', async () => {
    const directory = await workspace();
    const result = await renderSheet(await modelFixture(directory), join(directory, 'software.webp'), {
      executablePath: '/usr/bin/chromium',
      software: true,
      views: ['three-quarter'],
    });
    expect(result.software).toBe(true);
    expect(result.renderer).toMatch(/SwiftShader|software|llvmpipe/i);
  }, 90_000);

  it('caps live browser contexts at two and releases every permit', async () => {
    const directory = await workspace();
    const model = await modelFixture(directory);
    previewContextStats(true);
    await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        renderSheet(model, join(directory, `concurrent-${index}.webp`), {
          executablePath: '/usr/bin/chromium',
          software: true,
          views: ['three-quarter'],
        }),
      ),
    );
    expect(previewContextStats()).toEqual({ active: 0, peak: 2 });
  }, 120_000);
});

describe('renderCollectionSheet', () => {
  it('paginates deterministically at forty-eight thumbnails', async () => {
    const directory = await workspace();
    const thumbnails = await Promise.all(
      Array.from({ length: 50 }, async (_, index) => {
        const path = join(directory, `${String(index).padStart(2, '0')}.png`);
        await sharp({
          create: { width: 8, height: 8, channels: 3, background: { r: index * 3, g: 40, b: 80 } },
        })
          .png()
          .toFile(path);
        return path;
      }),
    );

    const out = join(directory, 'collection.webp');
    const result = await renderCollectionSheet(thumbnails, out);
    expect(result.pages).toEqual([out, join(directory, 'collection-2.webp')]);
    expect((await sharp(result.pages[0]).metadata()).width).toBe(8 * 128);
    expect((await sharp(result.pages[1]).metadata()).height).toBe(128);
  });
});

describe('spriteSheet', () => {
  it('scales pixel art three times by default', async () => {
    const directory = await workspace();
    const source = join(directory, 'geometry.png');
    await sharp({ create: { width: 48, height: 32, channels: 4, background: '#ffffffff' } })
      .png()
      .toFile(source);
    const out = join(directory, 'geometry.webp');

    await spriteSheet(source, out, { pixelArt: true });

    expect(await sharp(out).metadata()).toMatchObject({ width: 144, height: 96 });
  });

  it('uses nearest-neighbour scaling only for pixel art', async () => {
    const directory = await workspace();
    const source = join(directory, 'sprite.png');
    await writeFile(
      source,
      await sharp({ create: { width: 2, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .composite([
          {
            input: Buffer.from('<svg width="1" height="1"><rect width="1" height="1" fill="white"/></svg>'),
            left: 1,
            top: 0,
          },
        ])
        .png()
        .toBuffer(),
    );

    const pixel = join(directory, 'pixel.webp');
    const smooth = join(directory, 'smooth.webp');
    await spriteSheet(source, pixel, { width: 32, height: 16, pixelArt: true });
    await spriteSheet(source, smooth, { width: 32, height: 16, pixelArt: false });

    const pixelRaw = await sharp(await readFile(pixel))
      .raw()
      .toBuffer();
    const smoothRaw = await sharp(await readFile(smooth))
      .raw()
      .toBuffer();
    expect(new Set(pixelRaw).size).toBeLessThan(new Set(smoothRaw).size);
  });
});
