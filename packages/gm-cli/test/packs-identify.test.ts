import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { identify } from '../src/packs/identify.js';
import { tempDir } from './helpers.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('identify', () => {
  it('rejects control characters in extracted paths', async () => {
    const root = tempDir('gm-identify-control-');
    temporary.push(root);
    await writeFile(join(root, 'unsafe\u001b]52.unity'), 'scene');
    await expect(identify(root)).rejects.toThrow('control or formatting characters');
  });

  it('records named GLB scenes without treating ordinary models as scenes', async () => {
    const root = tempDir('gm-identify-scenes-');
    temporary.push(root);
    await mkdir(join(root, 'scenes'));
    await writeFile(join(root, 'scenes', 'castle.glb'), 'scene');
    await writeFile(join(root, 'chair.glb'), 'model');
    await writeFile(join(root, 'village.umap'), 'unreal scene');
    const result = await identify(root);
    expect(result.sceneSources).toEqual(['scenes/castle.glb', 'village.umap']);
  });
  it('recognizes Kenney CC0 and groups sibling textures with a model', async () => {
    const root = tempDir('gm-identify-');
    temporary.push(root);
    await mkdir(join(root, 'Models', 'Textures'), { recursive: true });
    await writeFile(join(root, 'License.txt'), 'Kenney assets are licensed CC0 1.0.');
    await writeFile(join(root, 'Models', 'wall.obj'), 'o wall');
    await writeFile(join(root, 'Models', 'Textures', 'colormap.png'), 'pixels');

    const result = await identify(root);
    expect(result.vendor).toBe('kenney');
    expect(result).not.toHaveProperty('license');
    expect(result.items).toContainEqual(
      expect.objectContaining({ path: 'Models/wall.obj', kind: 'model', companions: ['Models/Textures/colormap.png'] }),
    );
    expect(result.hashManifest).toContain('Models/wall.obj');
  });

  it('removes executable files and records them without ever opening them', async () => {
    const root = tempDir('gm-identify-exe-');
    temporary.push(root);
    await writeFile(join(root, 'readme.txt'), 'hello');
    await writeFile(join(root, 'run.sh'), '#!/bin/sh\necho unsafe\n');
    await writeFile(join(root, 'asset.meta'), 'engine-only');
    await writeFile(join(root, 'renamed-binary'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]));

    const result = await identify(root);
    expect(result.dropped).toEqual(['asset.meta', 'renamed-binary', 'run.sh']);
    await expect(readFile(join(root, 'run.sh'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'asset.meta'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'renamed-binary'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('links only matching texture siblings to each model', async () => {
    const root = tempDir('gm-identify-companions-');
    temporary.push(root);
    await mkdir(join(root, 'House', 'Models'), { recursive: true });
    await mkdir(join(root, 'House', 'Textures'), { recursive: true });
    await mkdir(join(root, 'Hero', 'Models'), { recursive: true });
    await mkdir(join(root, 'Hero', 'Textures'), { recursive: true });
    await writeFile(join(root, 'House', 'Models', 'wall.obj'), 'o wall');
    await writeFile(join(root, 'House', 'Textures', 'wall.png'), 'wall pixels');
    await writeFile(join(root, 'Hero', 'Models', 'orc.obj'), 'o orc');
    await writeFile(join(root, 'Hero', 'Textures', 'orc.png'), 'orc pixels');

    const result = await identify(root);
    expect(result.items.find(({ path }) => path.endsWith('wall.obj'))?.companions).toEqual(['House/Textures/wall.png']);
    expect(result.items.find(({ path }) => path.endsWith('orc.obj'))?.companions).toEqual(['Hero/Textures/orc.png']);
  });

  it('parses Synty material lists and Kenney tilesheet dimensions', async () => {
    const root = tempDir('gm-identify-metadata-');
    temporary.push(root);
    await mkdir(join(root, 'Models'), { recursive: true });
    await mkdir(join(root, 'Tiles'), { recursive: true });
    await writeFile(join(root, 'Models', 'SM_Prop_Torch_01.fbx'), 'model');
    await writeFile(
      join(root, 'MaterialList_Test.txt'),
      'SM_Prop_Torch_01\nMaterial: Torch\nTexture: Torch_Albedo.png\n',
    );
    await writeFile(join(root, 'Tilesheet.txt'), 'Tile width: 16\nTile height: 16\nTile spacing: 1\n');
    await writeFile(join(root, 'Tiles', 'tile_0001.png'), 'pixels');
    await writeFile(join(root, 'preview.png'), 'pixels');

    const result = await identify(root);

    expect(result.items.find(({ path }) => path.endsWith('.fbx'))?.companions).toContain('MaterialList_Test.txt');
    expect(result.items.find(({ path }) => path.startsWith('Tiles/'))).toMatchObject({
      kind: 'sprite',
      subkind: 'tile',
      vendor: { tilePx: 16, spacingPx: 1 },
    });
    expect(result.items.find(({ path }) => path === 'preview.png')).not.toHaveProperty('vendor');
  });
});
