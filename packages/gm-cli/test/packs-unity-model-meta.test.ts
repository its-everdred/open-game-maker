import { expect, it } from 'vitest';
import { meshNameFromMeta, validateMeshImportSettings } from '../src/packs/unity/model-meta.js';

it('rejects FBX import settings whose mesh coordinates are not supported', () => {
  const defaults =
    'ModelImporter:\n  meshes:\n    globalScale: 1\n    useFileUnits: 1\n    useFileScale: 1\n    bakeAxisConversion: 0\n    swapUVChannels: 0\n';
  expect(() => validateMeshImportSettings(defaults)).not.toThrow();
  for (const [key, from, to] of [
    ['globalScale', '1', '2'],
    ['useFileUnits', '1', '0'],
    ['useFileScale', '1', '0'],
    ['bakeAxisConversion', '0', '1'],
    ['swapUVChannels', '0', '1'],
  ]) {
    expect(() => validateMeshImportSettings(defaults.replace(`${key}: ${from}`, `${key}: ${to}`))).toThrow(key);
  }
});

it('resolves model subasset names without losing 64-bit IDs', () => {
  const legacy = `ModelImporter:\n  fileIDToRecycleName:\n    4300000: Roof\n`;
  const modern = `ModelImporter:\n  internalIDToNameTable:\n  - first:\n      43: 9223372036854775807\n    second: Door\n`;
  expect(meshNameFromMeta(legacy, '4300000')).toBe('Roof');
  expect(meshNameFromMeta(modern, '9223372036854775807')).toBe('Door');
  expect(() => meshNameFromMeta(legacy, '42')).toThrow('missing Unity mesh name');
});

it('reports inferred names only for modern metadata without a name table', () => {
  const metadata = 'ModelImporter:\n  internalIDToNameTable: []\n  meshes:\n    fileIdsGeneration: 2\n';
  let inferred = false;
  expect(
    meshNameFromMeta(metadata, '123', {
      name: 'House_LOD0',
      onInferred: () => {
        inferred = true;
      },
    }),
  ).toBe('House_LOD0');
  expect(inferred).toBe(true);
  expect(() => meshNameFromMeta(metadata, '123')).toThrow('missing Unity mesh name');
  expect(() =>
    meshNameFromMeta(metadata.replace('fileIdsGeneration: 2', 'fileIdsGeneration: 1'), '123', {
      name: 'House',
      onInferred: () => {},
    }),
  ).toThrow('missing Unity mesh name');
});
