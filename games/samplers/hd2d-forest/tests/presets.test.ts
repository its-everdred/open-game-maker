import { describe, expect, it } from 'vitest';

import { focusQuality } from '../src/presets.js';

describe('forest presets', () => {
  // Kevin's round 2 phone budget: keep the blur on low and save by lighting fewer sprites instead.
  it('keeps the focus blur on the low tier', () => {
    expect(focusQuality(true, 'low')).toBe('low');
    expect(focusQuality(true, 'high')).toBe('high');
  });

  it('turns focus off only when the player turns it off', () => {
    expect(focusQuality(false, 'low')).toBe('off');
    expect(focusQuality(false, 'high')).toBe('off');
  });
});
