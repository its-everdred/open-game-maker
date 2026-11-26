import { expect, it } from 'vitest';
import { parseUnitySurface } from '../src/packs/unity/material.js';

it('extracts base texture, UV transform and tint from Unity material', () => {
  const source = `--- !u!21 &2100000
Material:
  m_SavedProperties:
    m_TexEnvs:
    - _BaseColorMap:
        m_Texture: {fileID: 2800000, guid: texture}
        m_Scale: {x: 2, y: 3}
        m_Offset: {x: 0.25, y: 0}
    m_Colors:
    - _BaseColor: {r: 0.5, g: 1, b: 0.25, a: 1}
`;
  expect(parseUnitySurface(source)).toEqual({
    textures: [{ guid: 'texture', scale: [2, 3], offset: [0.25, 0] }],
    color: [0.5, 1, 0.25, 1],
  });
  expect(() => parseUnitySurface(source.replace('_BaseColorMap', '_SampleTexture2D_abcdef_Texture_1'))).toThrow(
    'unsupported Unity shader graph',
  );
});

it('refuses transparency that the exporter cannot represent', () => {
  const source = `--- !u!21 &1
Material:
  stringTagMap: {RenderType: TransparentCutout}
  m_SavedProperties: {}
`;
  expect(() => parseUnitySurface(source)).toThrow('unsupported transparent or alpha-clipped');
});
