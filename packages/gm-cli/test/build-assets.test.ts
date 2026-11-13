import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { assetManifestSchema, type AssetManifest, type AssetMetadata } from '@ogm/contracts';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

type LockAsset = {
  id: string;
  path: string;
  license?: string;
  private?: boolean;
  meta?: AssetMetadata;
};

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const ffprobeAvailable = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const toktxAvailable = spawnSync('toktx', ['--version'], { stdio: 'ignore' }).status === 0;

function sha256(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeAsset(cwd: string, path: string, bytes: Uint8Array | Buffer): string {
  const target = join(cwd, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, bytes);
  return sha256(bytes);
}

function writeLock(cwd: string, assets: LockAsset[], family = 'chunky-low-poly'): void {
  const entries = assets
    .map((asset) => {
      const bytes = readFileSync(join(cwd, asset.path));
      return {
        id: asset.id,
        sha256: sha256(bytes),
        path: asset.path,
        license: asset.license ?? 'CC0-1.0',
        rights: {
          uses: ['in-game'],
          audience: asset.private ? 'private' : 'public',
          redistribution: asset.private ? 'in-build' : 'free',
          attribution: asset.private ? 'Private vendor' : null,
        },
        credit: {
          pack: asset.private ? 'fixture-private' : 'fixture-free',
          title: asset.private ? 'Private fixture assets' : 'Free fixture assets',
          licenseSource: asset.private ? 'Fixture vendor licence' : 'Fixture CC0 declaration',
          attribution: asset.private ? 'Private vendor' : 'none required',
          source: { label: 'test fixture' },
        },
        ...(asset.meta ? { meta: asset.meta } : {}),
        added: '2026-11-01',
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  writeFileSync(
    join(cwd, 'assets.lock.json'),
    `${JSON.stringify({ version: 1, family, pov: 'iso', assets: entries }, null, 2)}\n`,
  );
}

function updateLockEntry(cwd: string, id: string, changes: Record<string, unknown>): void {
  const path = join(cwd, 'assets.lock.json');
  const lock = JSON.parse(readFileSync(path, 'utf8')) as { assets: Array<Record<string, unknown>> };
  const entry = lock.assets.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`missing fixture lock entry ${id}`);
  Object.assign(entry, changes);
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
}

async function png(width: number, height: number, random = false): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  let seed = 0x12345678;
  for (let offset = 0; offset < data.length; offset += 3) {
    if (random) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[offset] = seed & 0xff;
      data[offset + 1] = (seed >>> 8) & 0xff;
      data[offset + 2] = (seed >>> 16) & 0xff;
    } else {
      data[offset] = offset % 2 === 0 ? 255 : 0;
      data[offset + 1] = 64;
      data[offset + 2] = 192;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: random ? 0 : 9 })
    .toBuffer();
}

function wav(): Buffer {
  const sampleRate = 8_000;
  const samples = 800;
  const dataBytes = samples * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) {
    bytes.writeInt16LE(Math.round(Math.sin((index / sampleRate) * Math.PI * 440 * 2) * 8_000), 44 + index * 2);
  }
  return bytes;
}

async function glb(width: number, height: number, texture?: Buffer, rigged = false, animated = false): Promise<Buffer> {
  const document = new Document();
  const buffer = document.createBuffer();
  const vertexCount = (width + 1) * (height + 1);
  const positions = new Float32Array((width + 1) * (height + 1) * 3);
  let positionOffset = 0;
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      positions[positionOffset++] = x;
      positions[positionOffset++] = 0;
      positions[positionOffset++] = y;
    }
  }
  const indices = new Uint32Array(width * height * 6);
  let indexOffset = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const top = y * (width + 1) + x;
      indices.set([top, top + width + 1, top + 1, top + 1, top + width + 1, top + width + 2], indexOffset);
      indexOffset += 6;
    }
  }
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setIndices(document.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
  if (texture) {
    const uvs = new Float32Array(vertexCount * 2);
    for (let y = 0; y <= height; y += 1) {
      for (let x = 0; x <= width; x += 1) {
        const offset = (y * (width + 1) + x) * 2;
        uvs[offset] = x / width;
        uvs[offset + 1] = y / height;
      }
    }
    primitive.setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer));
    const material = document
      .createMaterial()
      .setBaseColorTexture(document.createTexture().setImage(texture).setMimeType('image/png'));
    primitive.setMaterial(material);
  }
  const mesh = document.createMesh().addPrimitive(primitive);
  const meshNode = document.createNode().setMesh(mesh);
  const scene = document.createScene().addChild(meshNode);
  if (animated) {
    const times = document
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Float32Array([0, 1]))
      .setBuffer(buffer);
    const rotations = document
      .createAccessor()
      .setType('VEC4')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0.707, 0, 0.707]))
      .setBuffer(buffer);
    for (const name of ['open', 'close']) {
      const sampler = document.createAnimationSampler().setInput(times).setOutput(rotations);
      document
        .createAnimation(name)
        .addSampler(sampler)
        .addChannel(
          document.createAnimationChannel().setSampler(sampler).setTargetNode(meshNode).setTargetPath('rotation'),
        );
    }
  }
  if (rigged) {
    const joints = new Uint16Array(vertexCount * 4);
    const weights = new Float32Array(vertexCount * 4);
    for (let index = 0; index < vertexCount; index += 1) weights[index * 4] = 1;
    primitive
      .setAttribute('JOINTS_0', document.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer))
      .setAttribute('WEIGHTS_0', document.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
    const joint = document.createNode('RootJoint');
    const inverseBindMatrix = new Float32Array(16);
    inverseBindMatrix[0] = 1;
    inverseBindMatrix[5] = 1;
    inverseBindMatrix[10] = 1;
    inverseBindMatrix[15] = 1;
    meshNode.setSkin(
      document
        .createSkin()
        .setInverseBindMatrices(document.createAccessor().setType('MAT4').setArray(inverseBindMatrix).setBuffer(buffer))
        .addJoint(joint),
    );
    scene.addChild(joint);
  }
  return Buffer.from(await new NodeIO().writeBinary(document));
}

async function fixtureGame(): Promise<{ cwd: string; meta: AssetMetadata }> {
  const cwd = tempDir('gm-build-assets-');
  const colormap = await png(16, 16);
  if (ffmpegAvailable) writeAsset(cwd, 'assets/audio/tone.wav', wav());
  writeAsset(cwd, 'assets/image/sheet.png', await png(16, 8));
  writeAsset(cwd, 'assets/model/kit/tower.glb', await glb(12, 12, colormap));
  writeAsset(cwd, 'assets/model/kit/chest.glb', await glb(4, 4, colormap, false, true));
  writeAsset(cwd, 'assets/model/declared/chest.glb', await glb(4, 4, colormap, false, true));
  writeAsset(cwd, 'assets/model/kit/wall.glb', await glb(16, 12, colormap));
  writeAsset(cwd, 'assets/model/kit/rig-meta.glb', await glb(4, 4, colormap));
  writeAsset(cwd, 'assets/model/declared/a.glb', await glb(4, 4, await png(8, 8)));
  writeAsset(cwd, 'assets/model/declared/b.glb', await glb(4, 4, await png(8, 8, true)));
  writeAsset(cwd, 'assets/model/grid.glb', await glb(100, 50));
  writeAsset(cwd, 'assets/model/rigged.glb', await glb(20, 10, undefined, true));
  writeAsset(cwd, 'assets/ui/test.ttf', Buffer.from('font fixture'));
  const meta = {
    sprite: {
      drawn_view: 'iso',
      animations: [
        {
          name: 'walk',
          frames: [0, 1],
          sheets: [{ path: 'sheet.png', frame_w: 8, frame_h: 8, cols: 2, rows: 1 }],
        },
      ],
    },
  } satisfies AssetMetadata;
  writeLock(cwd, [
    ...(ffmpegAvailable ? [{ id: 't3:fixture/audio-tone', path: 'assets/audio/tone.wav' }] : []),
    { id: 't3:fixture/image-sheet', path: 'assets/image/sheet.png', meta },
    { id: 't3:fixture/kit-chest', path: 'assets/model/kit/chest.glb' },
    {
      id: 't3:fixture/declared-chest',
      path: 'assets/model/declared/chest.glb',
      meta: { kit: { piece: 'wall', grid_m: 1 } },
    },
    { id: 't3:fixture/kit-tower', path: 'assets/model/kit/tower.glb' },
    { id: 't3:fixture/kit-wall', path: 'assets/model/kit/wall.glb' },
    {
      id: 't3:fixture/kit-rig-meta',
      path: 'assets/model/kit/rig-meta.glb',
      meta: { rig: { rig_type: 'humanoid', rig_id: 'rig:0123456789ab', joint_count: 1, clips: [] } },
    },
    { id: 't3:fixture/declared-a', path: 'assets/model/declared/a.glb', meta: { kit: { piece: 'wall', grid_m: 1 } } },
    { id: 't3:fixture/declared-b', path: 'assets/model/declared/b.glb', meta: { kit: { piece: 'wall', grid_m: 1 } } },
    {
      id: 't3:fixture/model-grid',
      path: 'assets/model/grid.glb',
      license: 'LicenseRef-private',
      private: true,
    },
    { id: 't3:fixture/model-rigged', path: 'assets/model/rigged.glb' },
    { id: 't3:fixture/ui-font', path: 'assets/ui/test.ttf' },
  ]);
  return { cwd, meta };
}

function outputMtimes(out: string): Record<string, number> {
  return Object.fromEntries(readdirSync(out).map((name) => [name, statSync(join(out, name)).mtimeMs]));
}

function outputPath(cwd: string, url: string): string {
  return join(cwd, 'public', url.slice(1));
}

describe('gm build assets', () => {
  const kenneyChest = join(
    process.cwd(),
    '../../assets-local/packs/kenney-mini-dungeon/2.0/extracted/Models/GLB format/chest.glb',
  );
  it.skipIf(!existsSync(kenneyChest))('preserves the local Kenney Mini Dungeon chest clips', async () => {
    const cwd = tempDir('gm-build-chest-');
    const path = 'assets/model/kit/chest.glb';
    const chestIo = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const source = await chestIo.read(kenneyChest);
    writeAsset(cwd, path, await chestIo.writeBinary(source));
    writeLock(cwd, [{ id: 't3:fixture/chest', path }]);
    const result = await gm(['build', 'assets', '--json'], { cwd });
    expect(result, JSON.stringify(result)).toMatchObject({ code: 0, err: [] });
    const manifest = assetManifestSchema.parse(
      JSON.parse(readFileSync(join(cwd, 'public/assets/manifest.json'), 'utf8')),
    );
    const asset = manifest.assets['t3:fixture/chest']!;
    expect(asset.file['*']).toBeUndefined();
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const input = await io.read(kenneyChest);
    const expected = input
      .getRoot()
      .listAnimations()
      .map((animation) => animation.getName())
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    for (const tier of ['desktop', 'mobile', 'low'] as const) {
      const output = await io.read(outputPath(cwd, asset.file[tier]!));
      expect(
        output
          .getRoot()
          .listAnimations()
          .map((animation) => animation.getName())
          .sort(),
      ).toEqual(expected);
    }
  });
  it('builds tiered assets, validates the manifest, preserves metadata, and reuses the cache', async () => {
    const { cwd, meta } = await fixtureGame();
    const events = join(cwd, 'events.jsonl');
    const first = await gm(['build', 'assets', '--json'], { cwd, env: { GM_EVENTS_FILE: events } });
    expect(first, JSON.stringify(first)).toMatchObject({ code: 0, err: [] });

    const out = join(cwd, 'public/a');
    const manifest = assetManifestSchema.parse(
      JSON.parse(readFileSync(join(cwd, 'public/assets/manifest.json'), 'utf8')),
    );
    expect(manifest.tiers).toEqual(['desktop', 'mobile', 'low']);
    /* The sheet path becomes the generated file name so a game reads the sheet through the manifest. */
    const sheetFile = manifest.assets['t3:fixture/image-sheet']!.file['*']!;
    const sheetName = sheetFile.slice('/a/'.length);
    const [walk] = meta.sprite.animations;
    expect(manifest.assets['t3:fixture/image-sheet']?.meta).toEqual({
      sprite: {
        ...meta.sprite,
        animations: [{ ...walk, sheets: [{ ...walk.sheets[0], path: sheetName }] }],
      },
    });
    expect(manifest.files[sheetFile]).toBeDefined();
    expect(manifest.assets['t3:fixture/model-grid']?.license).toEqual({
      id: 'LicenseRef-private',
      attribution: 'Private vendor',
      use: 'personal',
    });
    for (const [name, file] of Object.entries(manifest.files)) {
      expect(statSync(outputPath(cwd, name)).size).toBe(file.bytes);
    }

    const kitName = manifest.assets['t3:fixture/kit-wall']?.file['*'];
    expect(kitName).toBe(manifest.assets['t3:fixture/kit-tower']?.file['*']);
    expect(manifest.files[kitName!]?.decoders).toEqual(['meshopt']);
    expect(readFileSync(outputPath(cwd, kitName!), 'utf8')).toContain('EXT_meshopt_compression');
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    for (const id of ['t3:fixture/kit-chest', 't3:fixture/declared-chest']) {
      const chest = manifest.assets[id]!;
      expect(chest.file['*']).toBeUndefined();
      for (const tier of ['desktop', 'mobile', 'low'] as const) {
        const built = await io.read(outputPath(cwd, chest.file[tier]!));
        expect(
          built
            .getRoot()
            .listAnimations()
            .map((animation) => animation.getName())
            .sort(),
        ).toEqual(['close', 'open']);
        expect(
          built
            .getRoot()
            .listAnimations()
            .every((animation) => animation.listChannels()[0]?.getTargetNode()),
        ).toBe(true);
      }
    }
    const kit = await io.read(outputPath(cwd, kitName!));
    expect(
      kit
        .getRoot()
        .listMeshes()
        .map((mesh) => mesh.getName())
        .sort(),
    ).toEqual(['t3:fixture/kit-tower', 't3:fixture/kit-wall']);
    expect(
      kit
        .getRoot()
        .listMeshes()
        .every((mesh) => Array.isArray(mesh.getExtras().bounds)),
    ).toBe(true);
    expect((kit.getRoot().getAsset() as { extras?: { license?: unknown } }).extras?.license).toBeDefined();
    for (const mesh of kit.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const indices = primitive.getIndices()!;
        const uvs = primitive.getAttribute('TEXCOORD_0')!;
        for (let index = 0; index < indices.getCount(); index += 3) {
          const first = uvs.getElement(indices.getScalar(index), [0, 0]);
          const second = uvs.getElement(indices.getScalar(index + 1), [0, 0]);
          const third = uvs.getElement(indices.getScalar(index + 2), [0, 0]);
          expect(second).toEqual(first);
          expect(third).toEqual(first);
        }
      }
    }
    const kitInputBytes =
      statSync(join(cwd, 'assets/model/kit/tower.glb')).size + statSync(join(cwd, 'assets/model/kit/wall.glb')).size;
    expect(statSync(outputPath(cwd, kitName!)).size).toBeLessThan(kitInputBytes);

    const rigMeta = manifest.assets['t3:fixture/kit-rig-meta']!;
    expect(rigMeta.file['*']).toBeUndefined();
    expect(Object.keys(rigMeta.file).sort()).toEqual(['desktop', 'low', 'mobile']);
    const declaredKitName = manifest.assets['t3:fixture/declared-a']!.file['*'];
    expect(declaredKitName).toBe(manifest.assets['t3:fixture/declared-b']!.file['*']);

    const model = manifest.assets['t3:fixture/model-grid']!;
    const triangleCounts = ['desktop', 'mobile', 'low'].map(
      (tier) => manifest.files[model.file[tier as keyof typeof model.file]!]!.tris!,
    );
    expect(triangleCounts[0]).toBeGreaterThan(triangleCounts[1]!);
    expect(triangleCounts[1]).toBeGreaterThan(triangleCounts[2]!);

    const rigged = manifest.assets['t3:fixture/model-rigged']!;
    for (const tier of ['desktop', 'mobile', 'low'] as const) {
      const document = await io.read(outputPath(cwd, rigged.file[tier]!));
      expect(document.getRoot().listSkins()).toHaveLength(1);
      expect(document.getRoot().listSkins()[0]!.listJoints()).toHaveLength(1);
    }

    const imageName = manifest.assets['t3:fixture/image-sheet']!.file['*']!;
    expect(imageName.endsWith('.webp')).toBe(true);
    expect(await sharp(outputPath(cwd, imageName)).metadata()).toMatchObject({ width: 16, height: 8, format: 'webp' });
    if (ffmpegAvailable) {
      const audioName = manifest.assets['t3:fixture/audio-tone']!.file['*']!;
      expect(audioName.endsWith('.mp3')).toBe(true);
      expect(existsSync(outputPath(cwd, audioName))).toBe(true);
    }
    const fontName = manifest.assets['t3:fixture/ui-font']!.file['*']!;
    expect(readFileSync(outputPath(cwd, fontName), 'utf8')).toBe('font fixture');

    const updatedMeta = {
      ...meta,
      sprite: {
        ...meta.sprite,
        animations: [
          {
            name: 'walk',
            frames: [0, 1, 2, 3],
            sheets: [{ path: 'sheet.png', frame_w: 4, frame_h: 8, cols: 4, rows: 1 }],
          },
        ],
      },
    };
    updateLockEntry(cwd, 't3:fixture/image-sheet', { meta: updatedMeta });
    updateLockEntry(cwd, 't3:fixture/model-grid', {
      license: 'LicenseRef-updated',
      rights: {
        uses: ['in-game'],
        audience: 'private',
        redistribution: 'in-build',
        attribution: 'Updated vendor',
      },
    });
    const second = await gm(['build', 'assets', '--json'], { cwd, env: { GM_EVENTS_FILE: events } });
    expect(second.code).toBe(0);
    const secondOutput = JSON.parse(second.out[0]!) as { cache: { hits: number; misses: number } };
    expect(secondOutput.cache.misses).toBeGreaterThanOrEqual(2);
    const updatedManifest = assetManifestSchema.parse(
      JSON.parse(readFileSync(join(cwd, 'public/assets/manifest.json'), 'utf8')),
    );
    const updatedSheetName = updatedManifest.assets['t3:fixture/image-sheet']!.file['*']!.slice('/a/'.length);
    expect(updatedManifest.assets['t3:fixture/image-sheet']?.meta).toEqual({
      ...updatedMeta,
      sprite: {
        ...updatedMeta.sprite,
        animations: [
          {
            ...updatedMeta.sprite.animations[0],
            sheets: [{ ...updatedMeta.sprite.animations[0].sheets[0], path: updatedSheetName }],
          },
        ],
      },
    });
    expect(updatedManifest.assets['t3:fixture/model-grid']?.license).toEqual({
      id: 'LicenseRef-updated',
      attribution: 'Updated vendor',
      use: 'personal',
    });

    const before = outputMtimes(out);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const third = await gm(['build', 'assets', '--json'], { cwd, env: { GM_EVENTS_FILE: events } });
    expect(third.code).toBe(0);
    expect(outputMtimes(out)).toEqual(before);
    expect(readdirSync(join(cwd, '.gm/cache/assets')).length).toBeGreaterThan(0);
    expect(readdirSync(join(cwd, '.gm/cache/assets/facts')).some((name) => name.endsWith('.json'))).toBe(true);
    const emitted = readFileSync(events, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string });
    expect(emitted.filter((event) => event.event === 'assets.build')).toHaveLength(3);
  });

  it('writes every exceeded mobile budget number and exits 1', async () => {
    const cwd = tempDir('gm-build-budget-');
    writeAsset(cwd, 'assets/image/large.png', await png(2_048, 2_048, true));
    writeLock(cwd, [{ id: 't3:fixture/large-texture', path: 'assets/image/large.png' }]);
    const result = await gm(['build', 'assets', '--budget', 'mobile', '--json'], { cwd, env: {} });
    expect(result.code).toBe(1);
    const output = JSON.parse(result.out[0]!) as { reports: Array<{ tier: string; exceeded: { metric: string }[] }> };
    const mobile = output.reports.find((report) => report.tier === 'mobile')!;
    expect(mobile.exceeded.map((item) => item.metric)).toEqual(expect.arrayContaining(['bytes', 'maxTexture']));
    expect(JSON.parse(readFileSync(join(cwd, 'public/assets/budget.json'), 'utf8'))).toEqual(output.reports);

    const human = await gm(['build', 'assets', '--budget', 'desktop'], { cwd, env: {} });
    expect(human.code).toBe(1);
    expect(human.err.length).toBeGreaterThan(0);
    expect(human.err.every((line) => line.startsWith('desktop budget exceeded:'))).toBe(true);
  }, 40_000);

  it('budgets lazy groups independently and honors game overrides on cached builds', async () => {
    const cwd = tempDir('gm-build-phases-');
    writeAsset(cwd, 'assets/image/a.png', await png(16, 16));
    writeLock(cwd, [{ id: 't3:fixture/a', path: 'assets/image/a.png' }]);
    updateLockEntry(cwd, 't3:fixture/a', { phase: 'lazy:backdrop-nim' });
    mkdirSync(join(cwd, '.gm'), { recursive: true });
    writeFileSync(join(cwd, '.gm/game.json'), JSON.stringify({ budgets: { lazy: { backdrop: { mobile: 0 } } } }));
    const first = await gm(['build', 'assets', '--json'], { cwd, env: {} });
    expect(first.code).toBe(1);
    const output = JSON.parse(first.out[0]!) as {
      manifest: AssetManifest;
      reports: Array<{ tier: string; phase?: string; bytes: number; exceeded: Array<{ metric: string }> }>;
    };
    expect(output.manifest.assets['t3:fixture/a']?.phase).toBe('lazy:backdrop-nim');
    expect(output.reports.find((r) => r.tier === 'mobile' && r.phase === 'boot')?.bytes).toBe(0);
    expect(
      output.reports.find((r) => r.tier === 'mobile' && r.phase === 'lazy:backdrop-nim')?.exceeded.map((x) => x.metric),
    ).toContain('bytes');
    writeFileSync(join(cwd, '.gm/game.json'), JSON.stringify({ budgets: { lazy: { backdrop: { mobile: 100000 } } } }));
    const second = await gm(['build', 'assets', '--json'], { cwd, env: {} });
    expect(second.code).toBe(0);
  });

  it.skipIf(toktxAvailable)('exits 2 and names toktx when --ktx2 cannot find the tool', async () => {
    const result = await gm(['build', 'assets', '--ktx2'], { env: {} });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('toktx');
  });

  // Lossy WebP bleeds colours across sprite-frame edges; a pixel-art game needs every source pixel back.
  it('encodes images losslessly for a pixel-art family game', async () => {
    const cwd = tempDir('gm-build-pixel-');
    const source = await png(16, 8, true);
    writeAsset(cwd, 'assets/image/sheet.png', source);
    writeLock(cwd, [{ id: 't3:fixture/pixel-sheet', path: 'assets/image/sheet.png' }], 'pixel-art');
    const result = await gm(['build', 'assets'], { cwd, env: {} });
    expect(result).toMatchObject({ code: 0, err: [] });
    const manifest = JSON.parse(readFileSync(join(cwd, 'public/assets/manifest.json'), 'utf8')) as AssetManifest;
    const name = manifest.assets['t3:fixture/pixel-sheet']!.file['*']!;
    const written = await sharp(outputPath(cwd, name)).removeAlpha().raw().toBuffer();
    expect(written.equals(await sharp(source).raw().toBuffer())).toBe(true);
  });

  // Large tilesets and contact sheets are not sprite sheets, but scaling them still breaks the pixel grid.
  it('keeps a pixel-art image over 2048 px at full size while other families still shrink it', async () => {
    const source = await png(2_100, 4, true);
    const build = async (family: string) => {
      const cwd = tempDir('gm-build-pixel-large-');
      writeAsset(cwd, 'assets/image/tileset.png', source);
      writeLock(cwd, [{ id: 't3:fixture/tileset', path: 'assets/image/tileset.png' }], family);
      /* Both sizes exceed the mobile texture budget; that exit code is not what this test guards. */
      await gm(['build', 'assets'], { cwd, env: {} });
      const manifest = JSON.parse(readFileSync(join(cwd, 'public/assets/manifest.json'), 'utf8')) as AssetManifest;
      return sharp(outputPath(cwd, manifest.assets['t3:fixture/tileset']!.file['*']!));
    };

    const pixel = await build('pixel-art');
    expect(await pixel.metadata()).toMatchObject({ width: 2_100, height: 4 });
    expect((await pixel.removeAlpha().raw().toBuffer()).equals(await sharp(source).raw().toBuffer())).toBe(true);

    expect((await (await build('chunky-low-poly')).metadata()).width).toBe(2_048);
  }, 40_000);

  it('finishes independent jobs for a corrupt GLB but does not replace the manifest', async () => {
    const cwd = tempDir('gm-build-corrupt-');
    writeAsset(cwd, 'assets/image/ok.png', await png(8, 8));
    writeAsset(cwd, 'assets/model/bad.glb', Buffer.from('not glb'));
    writeLock(cwd, [
      { id: 't3:fixture/bad-model', path: 'assets/model/bad.glb' },
      { id: 't3:fixture/ok-image', path: 'assets/image/ok.png' },
    ]);
    const result = await gm(['build', 'assets'], { cwd, env: {} });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('t3:fixture/bad-model');
    expect(readdirSync(join(cwd, 'public/a')).some((name) => name.endsWith('.webp'))).toBe(true);
    expect(existsSync(join(cwd, 'public/assets/manifest.json'))).toBe(false);

    const strictCwd = tempDir('gm-build-corrupt-strict-');
    writeAsset(strictCwd, 'assets/image/ok.png', await png(8, 8));
    writeAsset(strictCwd, 'assets/model/bad.glb', Buffer.from('not glb'));
    writeLock(strictCwd, [
      { id: 't3:fixture/bad-model', path: 'assets/model/bad.glb' },
      { id: 't3:fixture/ok-image', path: 'assets/image/ok.png' },
    ]);
    const strict = await gm(['build', 'assets', '--strict'], { cwd: strictCwd, env: {} });
    expect(strict.code).toBe(1);
    expect(existsSync(join(strictCwd, 'public/a'))).toBe(false);
  });

  it.skipIf(!ffmpegAvailable || !ffprobeAvailable)(
    'encodes WAV audio as MP3 when ffmpeg and ffprobe are available (skipped when absent)',
    async () => {
      const cwd = tempDir('gm-build-audio-');
      writeAsset(cwd, 'assets/audio/tone.wav', wav());
      writeLock(cwd, [{ id: 't3:fixture/tone', path: 'assets/audio/tone.wav' }]);
      const result = await gm(['build', 'assets'], { cwd, env: {} });
      expect(result.code).toBe(0);
      const manifest = JSON.parse(readFileSync(join(cwd, 'public/assets/manifest.json'), 'utf8')) as AssetManifest;
      const name = manifest.assets['t3:fixture/tone']!.file['*']!;
      expect(name).toMatch(/\.mp3$/);
      const probe = spawnSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=codec_name',
          '-of',
          'csv=p=0',
          outputPath(cwd, name),
        ],
        { encoding: 'utf8' },
      );
      expect(probe.status, probe.stderr).toBe(0);
      expect(probe.stdout.trim()).toBe('mp3');
    },
  );
});
