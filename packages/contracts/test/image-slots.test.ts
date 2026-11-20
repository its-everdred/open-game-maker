import { describe, expect, it } from 'vitest';
import { ImageSlots, REVIEW_VIEWPORTS, VIEWPORTS, contrastRatio, imageRules } from '../src/image-slots.js';

describe('image slots', () => {
  it('parses a layered image manifest and viewport anchor', () => {
    expect(
      ImageSlots.parse({
        tile: {
          mode: 'per-ratio',
          variants: { 'phone-portrait': 'media/tile.png', desktop: 'media/thumbnail.png' },
          text: { capHeight: 0.08, color: '#ffffff', background: '#1b1030' },
        },
        logo: {
          mode: 'layered',
          plate: 'media/logo-plate.png',
          layers: [{ src: 'media/logo-mark.png', anchors: { 'phone-portrait': { x: 0.5, y: 0.35, width: 0.8 } } }],
          variants: { 'phone-portrait': 'media/slots/logo-phone-portrait.png' },
        },
      }),
    ).toHaveProperty('logo');
  });

  it('rejects invalid media paths and viewport keys', () => {
    expect(
      ImageSlots.safeParse({ tile: { mode: 'per-ratio', variants: { 'phone-portrait': '../tile.png' } } }).success,
    ).toBe(false);
    expect(
      ImageSlots.safeParse({
        logo: {
          mode: 'layered',
          layers: [{ src: 'media/a.png', anchors: { unknown: { x: 0.5, y: 0.5, width: 0.8 } } }],
        },
      }).success,
    ).toBe(false);
  });

  it('merges image rule overrides over defaults', () => {
    expect(imageRules({ imageRules: { minTextPx: 18 } })).toEqual({
      ...{ safeMargin: 0.05, minTextPx: 16, minIconPx: 12, minContrastText: 4.5, minContrastLarge: 3 },
      minTextPx: 18,
    });
  });

  it('exposes the shared review viewport set and calculates WCAG contrast', () => {
    expect(REVIEW_VIEWPORTS.map((id) => VIEWPORTS[id])).toHaveLength(4);
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
  });
});
