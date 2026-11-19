import { describe, expect, it } from 'vitest';

import { previewKey } from '../src/index.js';

describe('previewKey', () => {
  it('fails closed to private keys unless redistribution permits previews', () => {
    expect(previewKey('a'.repeat(64), 'model-sheet', 'free')).toMatch(/^previews\//);
    expect(previewKey('a'.repeat(64), 'model-sheet', 'in-build')).toMatch(/^previews\//);
    expect(previewKey('a'.repeat(64), 'model-sheet', 'none')).toMatch(/^private\/previews\//);
    expect(previewKey('a'.repeat(64), 'model-sheet', undefined)).toMatch(/^private\/previews\//);
  });

  it('includes render parameters in deterministic content addresses', () => {
    const first = previewKey('a'.repeat(64), 'model-sheet', 'free', { views: 6, size: 256 });
    expect(first).toBe(previewKey('a'.repeat(64), 'model-sheet', 'free', { size: 256, views: 6 }));
    expect(first).not.toBe(previewKey('a'.repeat(64), 'model-sheet', 'free', { views: 1, size: 256 }));
  });
});
