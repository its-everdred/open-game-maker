import { expect, it } from 'vitest';
import { textureIsSrgb } from '../src/packs/unity/texture-meta.js';

it('reads the Unity texture importer color space and refuses unsupported sampling', () => {
  const metadata = (srgb: number, wrap: number) =>
    `TextureImporter:\n  mipmaps:\n    sRGBTexture: ${srgb}\n  textureSettings:\n    wrapU: ${wrap}\n    wrapV: 0\n    filterMode: 1\n`;
  expect(textureIsSrgb(metadata(1, 0))).toBe(true);
  expect(textureIsSrgb(metadata(0, 0))).toBe(false);
  expect(() => textureIsSrgb(metadata(1, 1))).toThrow('unsupported Unity texture sampling mode');
  expect(() => textureIsSrgb('TextureImporter: {}')).toThrow('missing Unity texture color space');
});
