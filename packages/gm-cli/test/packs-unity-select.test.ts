import { expect, it } from 'vitest';
import { selectUnityBuilding, selectUnityPieces } from '../src/packs/unity/select.js';
import type { UnityMeshNode } from '../src/packs/unity/hierarchy.js';

it('isolates a building while retaining parent transforms and excluding other meshes', () => {
  const node = (id: string, name: string, parentId: string | null): UnityMeshNode => ({
    transformId: id,
    name,
    parentId,
    position: [1, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    active: true,
    rendererActive: true,
    mesh: { fileId: '1', guid: id },
    materials: [],
  });
  const nodes = [
    node('world', 'World', null),
    node('house', 'House', 'world'),
    node('roof', 'Roof', 'house'),
    node('other', 'Tree', 'world'),
  ];
  expect(selectUnityBuilding(nodes, 'House')).toMatchObject([
    { transformId: 'world', rendererActive: false },
    { transformId: 'house' },
    { transformId: 'roof' },
  ]);
  expect(selectUnityBuilding(nodes, 'House')[0]?.mesh).toBeUndefined();
  expect(() => selectUnityBuilding([...nodes, node('house2', 'House', 'world')], 'House')).toThrow('ambiguous');
  expect(selectUnityPieces(nodes, ['house', 'other'])).toMatchObject([
    { transformId: 'world', rendererActive: false },
    { transformId: 'house', rendererActive: true },
    { transformId: 'roof', rendererActive: true },
    { transformId: 'other', rendererActive: true },
  ]);
  expect(selectUnityPieces(nodes, ['world', 'house'])[0]?.mesh).toBeDefined();
  expect(() => selectUnityPieces(nodes, ['house', 'house'])).toThrow('unique');
  expect(() => selectUnityPieces(nodes, ['Tree'])).toThrow('missing');
});
