import { expect, it } from 'vitest';
import { meshNameFromMeta } from '../src/packs/unity/model-meta.js';

it('resolves model subasset names without losing 64-bit IDs', () => {
  const legacy = `ModelImporter:\n  fileIDToRecycleName:\n    4300000: Roof\n`;
  const modern = `ModelImporter:\n  internalIDToNameTable:\n  - first:\n      43: 9223372036854775807\n    second: Door\n`;
  expect(meshNameFromMeta(legacy, '4300000')).toBe('Roof');
  expect(meshNameFromMeta(modern, '9223372036854775807')).toBe('Door');
  expect(() => meshNameFromMeta(legacy, '42')).toThrow('missing Unity mesh name');
});
