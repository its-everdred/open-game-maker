import { describe, expect, it } from 'vitest';

import { testSoftwareRenderer } from '../src/test-renderer.js';

describe('gm test renderer selection', () => {
  it('uses SwiftShader on Linux without a render device', () => {
    expect(
      testSoftwareRenderer(
        undefined,
        'linux',
        () => false,
        () => [],
      ),
    ).toBe(true);
    expect(
      testSoftwareRenderer(
        undefined,
        'linux',
        () => false,
        () => {
          throw new Error('missing');
        },
      ),
    ).toBe(true);
  });

  it('keeps hardware on systems with a render device or on other platforms', () => {
    expect(
      testSoftwareRenderer(
        undefined,
        'linux',
        () => false,
        () => ['card0', 'renderD128'],
      ),
    ).toBe(false);
    expect(
      testSoftwareRenderer(
        undefined,
        'linux',
        () => true,
        () => [],
      ),
    ).toBe(false);
    expect(
      testSoftwareRenderer(
        undefined,
        'darwin',
        () => false,
        () => [],
      ),
    ).toBe(false);
  });

  it('honours an explicit renderer setting', () => {
    expect(
      testSoftwareRenderer(
        false,
        'linux',
        () => false,
        () => [],
      ),
    ).toBe(false);
    expect(
      testSoftwareRenderer(
        true,
        'linux',
        () => true,
        () => ['renderD128'],
      ),
    ).toBe(true);
  });
});
