import { Document, NodeIO } from '@gltf-transform/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { kitPiece } from '../src/kit-piece.js';
import { fixtureLoader } from './fixtures/manifest.js';

/** Card ids carry the `:`, `/` and `.` three strips from node names, as real library ids do. */
const BUSH = 't1:kaykit-forest/bush_1@1.0';
const TREE = 't1:kaykit-forest/tree_1@1.0';
const ROCK = 't1:kaykit-forest/rock_1@1.0';

/**
 * A glb laid out the way `gm build assets` packs a kit: one node per card, node and mesh named by the card id, each
 * piece made of triangles (one per material) whose tallest is `height` metres so a test can tell which piece came back.
 */
async function glb(pieces: Record<string, number | number[]>): Promise<ArrayBuffer> {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene('Scene');
  for (const [name, heights] of Object.entries(pieces)) {
    const mesh = document.createMesh(name);
    for (const [index, height] of [heights].flat().entries()) {
      const position = document
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, height, 0]))
        .setBuffer(buffer);
      const material = document.createMaterial(`${name}-${index}`);
      mesh.addPrimitive(document.createPrimitive().setAttribute('POSITION', position).setMaterial(material));
    }
    scene.addChild(document.createNode(name).setMesh(mesh));
  }
  const bytes = await new NodeIO().writeBinary(document);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function height(mesh: { geometry: { computeBoundingBox(): void; boundingBox: { max: { y: number } } | null } }) {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.max.y;
}

async function packedForest() {
  const files = { 'forest.glb': await glb({ [BUSH]: 0.5, [TREE]: 4, [ROCK]: 1 }) };
  const card = (id: string) => ({ file: 'forest.glb', mesh: id });
  return fixtureLoader({ [BUSH]: card(BUSH), [TREE]: card(TREE), [ROCK]: card(ROCK) }, files);
}

afterEach(() => vi.unstubAllGlobals());

describe('kitPiece', () => {
  it('picks the card named mesh from a packed kit file, not the first one', async () => {
    const { loader } = await packedForest();
    expect(height(await kitPiece(loader, TREE))).toBe(4);
    expect(height(await kitPiece(loader, ROCK))).toBe(1);
    expect(height(await kitPiece(loader, BUSH))).toBe(0.5);
  });

  it('decodes the packed file once for all its cards', async () => {
    const { loader, fetch } = await packedForest();
    await Promise.all([kitPiece(loader, TREE), kitPiece(loader, ROCK)]);
    await kitPiece(loader, BUSH);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('forest.glb'))).toHaveLength(1);
  });

  it('hands every placement its own transform over the shared geometry', async () => {
    const { loader } = await packedForest();
    const first = await kitPiece(loader, TREE);
    const second = await kitPiece(loader, TREE);
    first.scale.setScalar(3);
    expect(second.scale.x).toBe(1);
    expect(second.geometry).toBe(first.geometry);
  });

  it('draws a card with two materials as one mesh with a material per part', async () => {
    const files = { 'weapons.glb': await glb({ [BUSH]: 0.5, [TREE]: [2, 3] }) };
    const { loader } = await fixtureLoader(
      { [BUSH]: { file: 'weapons.glb', mesh: BUSH }, [TREE]: { file: 'weapons.glb', mesh: TREE } },
      files,
    );
    const piece = await kitPiece(loader, TREE);
    expect(height(piece)).toBe(3);
    expect(piece.geometry.getAttribute('position').count).toBe(6);
    expect(piece.geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    expect((piece.material as { name: string }[]).map((material) => material.name)).toEqual([`${TREE}-0`, `${TREE}-1`]);
    expect((await kitPiece(loader, TREE)).geometry).toBe(piece.geometry);
  });

  it('takes the only mesh of a card that has its own file', async () => {
    const files = { 'tree.glb': await glb({ Tree_1: 4 }) };
    const { loader } = await fixtureLoader({ [TREE]: { file: 'tree.glb' } }, files);
    expect(height(await kitPiece(loader, TREE))).toBe(4);
  });

  it('refuses a packed file without the card rather than drawing another piece', async () => {
    const files = { 'forest.glb': await glb({ [BUSH]: 0.5, [ROCK]: 1 }) };
    const { loader } = await fixtureLoader({ [TREE]: { file: 'forest.glb', mesh: TREE } }, files);
    await expect(kitPiece(loader, TREE)).rejects.toThrow(`Kit card ${TREE} has no node named ${TREE} in forest.glb`);
  });

  it('refuses a card of its own file that holds several meshes', async () => {
    const files = { 'pair.glb': await glb({ A: 1, B: 2 }) };
    const { loader } = await fixtureLoader({ [TREE]: { file: 'pair.glb' } }, files);
    await expect(kitPiece(loader, TREE)).rejects.toThrow(
      `Kit card ${TREE} needs exactly one mesh in pair.glb, found 2`,
    );
  });
});
