import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Document, NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';

import type { AssetsLock } from '@ogm/contracts';

import { ORC, preparedLibrary, useOrc, WALL } from './assets-fixture.js';
import { gm, tempDir } from './helpers.js';

const MODELS = 'packs/kenney-mini-dungeon/2.0/extracted/Models/GLB format';

function triangle(
  document: Document,
  name: string,
  material: string,
  factor: [number, number, number, number] = [1, 1, 1, 1],
) {
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const position = document
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setMaterial(document.createMaterial(material).setBaseColorFactor(factor));
  return document.createMesh(name).addPrimitive(primitive);
}

/** A rigged character whose `arm-right` joint is the card's `hand-right` slot, like a KayKit model. */
async function character(): Promise<Uint8Array> {
  const document = new Document();
  const root = document.createNode('root');
  const arm = document.createNode('arm-right').setTranslation([0.3, 0.5, 0]);
  root.addChild(arm);
  /* A non-white, translucent starting factor shows the recolour multiplies rather than replaces. */
  const body = document.createNode('body').setMesh(triangle(document, 'body', 'colormap', [0.5, 1, 1, 0.8]));
  body.setSkin(document.createSkin('rig').addJoint(root).addJoint(arm));
  document.createScene().addChild(root).addChild(body);
  return new NodeIO().writeBinary(document);
}

async function prop(): Promise<Uint8Array> {
  const document = new Document();
  document.createScene().addChild(document.createNode('sword').setMesh(triangle(document, 'sword', 'steel')));
  return new NodeIO().writeBinary(document);
}

async function gameWithModels() {
  const cwd = tempDir();
  const root = preparedLibrary();
  writeFileSync(join(root, MODELS, 'character-orc.glb'), await character());
  writeFileSync(join(root, MODELS, 'wall.glb'), await prop());
  const blobRoot = tempDir('gm-blobs-');
  const env = { OGM_ASSETS_ROOT: root, OGM_BLOB_ROOT: blobRoot };
  expect((await useOrc(cwd, root)).code).toBe(0);
  expect((await gm(['assets', 'use', WALL, '--family', 'chunky-low-poly', '--pov', 'iso'], { cwd, env })).code).toBe(0);
  return { cwd, root, env, blobRoot };
}

function lock(cwd: string): AssetsLock {
  return JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
}

describe('gm assets variant makes a t3 clone and never touches the original', () => {
  it('recolours a material, attaches a prop at a card slot, and registers the clone with both sources', async () => {
    const { cwd, root, env, blobRoot } = await gameWithModels();
    const original = readFileSync(join(root, MODELS, 'character-orc.glb'));

    const result = await gm(
      [
        'assets',
        'variant',
        ORC,
        '--name',
        'red-orc',
        '--recolour',
        'colormap=#808080',
        '--prop',
        `${WALL}@hand-right`,
        '--game',
        'g1',
      ],
      { cwd, env },
    );

    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(readFileSync(join(root, MODELS, 'character-orc.glb')).equals(original)).toBe(true);
    expect(existsSync(join(cwd, 'assets/model/variants/red-orc.glb'))).toBe(false);
    const entry = lock(cwd).assets.find((candidate) => candidate.id === 't3:g1/model/variants/red-orc');
    expect(entry).toMatchObject({ source: 'blob', derived_from: [ORC, WALL] });

    const variant = await new NodeIO().readBinary(readFileSync(join(blobRoot, 'blobs/sha256', entry!.sha256)));
    const colormap = variant
      .getRoot()
      .listMaterials()
      .find((material) => material.getName() === 'colormap');
    /* glTF factors are linear: sRGB mid-grey #808080 is 0.2159 linear, not 0.5 and not 128; it multiplies the
       material's own factor (0.5 red, 0.8 alpha) instead of replacing it. */
    const [r, g, b, a] = colormap!.getBaseColorFactor();
    expect(r).toBeCloseTo(0.2159 * 0.5, 4);
    for (const channel of [g, b]) expect(channel).toBeCloseTo(0.2159, 4);
    expect(a).toBeCloseTo(0.8, 6);
    const sword = variant
      .getRoot()
      .listNodes()
      .find((node) => node.getName() === 'sword');
    expect(sword?.getParentNode()?.getName()).toBe('arm-right');
    expect(variant.getRoot().listScenes()).toHaveLength(1);
  });

  it('refuses a slot or joint the rig does not have and leaves no file or lock entry', async () => {
    const { cwd, env } = await gameWithModels();
    const before = readFileSync(join(cwd, 'assets.lock.json'), 'utf8');

    const result = await gm(
      ['assets', 'variant', ORC, '--name', 'tail-orc', '--prop', `${WALL}@tail`, '--game', 'g1'],
      {
        cwd,
        env,
      },
    );

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('has no slot or joint tail');
    expect(result.err.join('\n')).toContain('hand-right');
    expect(existsSync(join(cwd, 'assets/model/variants/tail-orc.glb'))).toBe(false);
    expect(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')).toBe(before);
  });

  it('refuses a material the model does not have instead of writing an unchanged clone', async () => {
    const { cwd, env } = await gameWithModels();

    const result = await gm(['assets', 'variant', ORC, '--name', 'blue-orc', '--recolour', 'cloth=#0000ff'], {
      cwd,
      env,
    });

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('no material named cloth');
    expect(result.err.join('\n')).toContain('colormap');
  });

  it('never overwrites a registered variant of the same name', async () => {
    const { cwd, env } = await gameWithModels();
    const args = ['assets', 'variant', ORC, '--name', 'red-orc', '--recolour', '*=#ff0000', '--game', 'g1'];
    expect((await gm(args, { cwd, env })).code).toBe(0);
    const first = lock(cwd).assets.find((entry) => entry.path === 'assets/model/variants/red-orc.glb')?.sha256;

    const again = await gm(['assets', 'variant', ORC, '--name', 'red-orc', '--recolour', '*=#00ff00', '--game', 'g1'], {
      cwd,
      env,
    });

    expect(again.code).toBe(2);
    expect(again.err.join('\n')).toContain('variants are never overwritten');
    expect(lock(cwd).assets.find((entry) => entry.path === 'assets/model/variants/red-orc.glb')?.sha256).toBe(first);
  });

  it('removes the clone when it cannot be registered, so no binary is left in the repo', async () => {
    const { cwd, root } = await gameWithModels();

    const result = await gm(
      ['assets', 'variant', ORC, '--name', 'red-orc', '--recolour', '*=#ff0000', '--game', 'g1'],
      {
        cwd,
        env: { OGM_ASSETS_ROOT: root },
      },
    );

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('no blob store');
    expect(existsSync(join(cwd, 'assets/model/variants/red-orc.glb'))).toBe(false);
  });

  it('registers nothing when CREDITS.md cannot be written, so the same name works on retry', async () => {
    const { cwd, env } = await gameWithModels();
    const before = readFileSync(join(cwd, 'assets.lock.json'), 'utf8');
    rmSync(join(cwd, 'CREDITS.md'), { force: true });
    mkdirSync(join(cwd, 'CREDITS.md'));
    const args = ['assets', 'variant', ORC, '--name', 'red-orc', '--recolour', '*=#ff0000', '--game', 'g1'];

    await expect(gm(args, { cwd, env })).rejects.toThrow('EISDIR');
    expect(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')).toBe(before);
    expect(existsSync(join(cwd, 'assets/model/variants/red-orc.glb'))).toBe(false);

    rmSync(join(cwd, 'CREDITS.md'), { recursive: true });
    expect((await gm(args, { cwd, env })).code).toBe(0);
    expect(lock(cwd).assets.some((entry) => entry.id === 't3:g1/model/variants/red-orc')).toBe(true);
  });

  it('only clones a model the game has locked', async () => {
    const { cwd, env } = await gameWithModels();
    const unknown = 't1:kenney-mini-dungeon/character-human@2.0';

    const result = await gm(['assets', 'variant', unknown, '--name', 'human', '--recolour', '*=#ff0000'], {
      cwd,
      env,
    });

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain(`gm assets use ${unknown}`);
  });

  it('attaches several props by raw joint name into one single-buffer glb', async () => {
    const { cwd, env, blobRoot } = await gameWithModels();

    const result = await gm(
      [
        'assets',
        'variant',
        ORC,
        '--name',
        'two-swords',
        '--prop',
        `${WALL}@arm-right`,
        '--prop',
        `${WALL}@root`,
        '--game',
        'g1',
      ],
      { cwd, env },
    );

    expect(result.err).toEqual([]);
    const entry = lock(cwd).assets.find((candidate) => candidate.id === 't3:g1/model/variants/two-swords');
    const variant = await new NodeIO().readBinary(readFileSync(join(blobRoot, 'blobs/sha256', entry!.sha256)));
    const parents = variant
      .getRoot()
      .listNodes()
      .filter((node) => node.getName() === 'sword')
      .map((node) => node.getParentNode()?.getName())
      .sort();
    expect(parents).toEqual(['arm-right', 'root']);
    expect(variant.getRoot().listBuffers()).toHaveLength(1);
  });

  it('refuses a registered variant as a source before cloning, since its provenance is not a library card', async () => {
    const { cwd, env } = await gameWithModels();
    expect(
      (
        await gm(['assets', 'variant', ORC, '--name', 'red-orc', '--recolour', '*=#ff0000', '--game', 'g1'], {
          cwd,
          env,
        })
      ).code,
    ).toBe(0);
    const before = readFileSync(join(cwd, 'assets.lock.json'), 'utf8');

    const result = await gm(
      [
        'assets',
        'variant',
        't3:g1/model/variants/red-orc',
        '--name',
        'blue-orc',
        '--recolour',
        '*=#0000ff',
        '--game',
        'g1',
      ],
      { cwd, env },
    );

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('is not a library asset');
    expect(existsSync(join(cwd, 'assets/model/variants/blue-orc.glb'))).toBe(false);
    expect(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')).toBe(before);
  });

  it.each([
    [['--name', 'Bad Name', '--recolour', '*=#ff0000'], 'lowercase slug'],
    [['--name', 'orc'], 'at least one --recolour or --prop'],
    [['--name', 'orc', '--recolour', 'colormap=red'], 'is not <material>=#rrggbb'],
    [['--name', 'orc', '--prop', 'hand-right'], 'is not <id>@<slot|joint>'],
    [['--name', 'orc', '--prop', `${WALL}@`], 'is not <id>@<slot|joint>'],
  ])('refuses malformed flags %j without writing anything', async (flags, message) => {
    const { cwd, env } = await gameWithModels();
    const before = readFileSync(join(cwd, 'assets.lock.json'), 'utf8');

    const result = await gm(['assets', 'variant', ORC, ...flags], { cwd, env });

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain(message);
    expect(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')).toBe(before);
  });
});
