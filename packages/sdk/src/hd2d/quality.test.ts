import { describe, expect, it } from 'vitest';

import { createFrameGovernor, pickQuality } from './quality.js';

describe('pickQuality', () => {
  it.each([
    // Without WebGL nothing can draw the effects, whatever the device.
    [{ dpr: 1, isMobile: false, webgl: false }, 'off'],
    [{ dpr: 3, isMobile: true, webgl: false }, 'off'],
    // Phones start low: #1225 measured high at a fraction of the effects-off frame rate.
    [{ dpr: 3, isMobile: true, webgl: true }, 'low'],
    [{ dpr: 1, isMobile: true, webgl: true }, 'low'],
    // Desktops start high unless the screen is dense enough to multiply every effect buffer's cost.
    [{ dpr: 1, isMobile: false, webgl: true }, 'high'],
    [{ dpr: 2, isMobile: false, webgl: true }, 'high'],
    [{ dpr: 3, isMobile: false, webgl: true }, 'low'],
  ] as const)('%o starts at %s', (device, quality) => {
    expect(pickQuality(device)).toBe(quality);
  });
});

describe('createFrameGovernor', () => {
  const budget = { frameMs: 33, slowFrames: 5 };

  it('drops one tier after N slow frames, then the next tier after N more, and never below off', () => {
    const governor = createFrameGovernor(budget);
    const tiers = [];
    let quality: 'off' | 'low' | 'high' = 'high';
    for (let frame = 0; frame < 15; frame += 1) tiers.push((quality = governor.sample(50, quality)));
    expect(tiers).toEqual([...Array(4).fill('high'), ...Array(5).fill('low'), ...Array(6).fill('off')]);
  });

  it('keeps the tier while frames are within budget, and lets fast frames forgive slow ones', () => {
    const governor = createFrameGovernor(budget);
    let quality: 'off' | 'low' | 'high' = 'high';
    for (let frame = 0; frame < 100; frame += 1) quality = governor.sample(frame % 2 ? 50 : 16, quality);
    expect(quality).toBe('high');
  });

  it('treats a long gap as a pause, not a slow frame', () => {
    const governor = createFrameGovernor(budget);
    let quality: 'off' | 'low' | 'high' = 'high';
    for (let frame = 0; frame < 20; frame += 1) quality = governor.sample(2000, quality);
    expect(quality).toBe('high');
  });

  it('starts counting again after a reset', () => {
    const governor = createFrameGovernor(budget);
    for (let frame = 0; frame < 4; frame += 1) governor.sample(50, 'high');
    governor.reset();
    expect(governor.sample(50, 'high')).toBe('high');
  });
});
