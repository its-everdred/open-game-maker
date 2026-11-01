import { describe, expect, it } from 'vitest';

import { OGM_ENV_NAMES, OGM_ENV_UNITS } from '../src/names.js';

describe('OGM_ENV_NAMES', () => {
  it('contains unique uppercase names with documentation', () => {
    const names = OGM_ENV_NAMES.map(({ name }) => name);

    expect(OGM_ENV_NAMES).toHaveLength(39);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(names.map((name) => name.toUpperCase()));
    expect(names.every((name) => /^[A-Z][A-Z0-9_]*$/.test(name))).toBe(true);
    expect(OGM_ENV_NAMES.every(({ doc }) => doc.trim().length > 0)).toBe(true);
  });

  it('lists every initializable unit independently of row ownership', () => {
    expect(OGM_ENV_UNITS).toEqual([
      'api',
      'rooms',
      'games',
      'commit',
      'voice-host',
      'intake',
      'drive-sync',
      'aiur',
      'backup',
      'gm',
    ]);
  });
});
