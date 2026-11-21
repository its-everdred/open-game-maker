import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';

import viteConfig from '../vite.config.js';

const configFor = (mode: string): UserConfig =>
  (viteConfig as (env: { mode: string; command: 'build' }) => UserConfig)({ mode, command: 'build' });

describe('licensed media boundary', () => {
  it.each(['published', 'production'])(
    'keeps public/assets-local out of a %s build and never enables private mode',
    (mode) => {
      const config = configFor(mode);
      expect(config.publicDir).toBe(false);
      expect(config.define?.__GM_PRIVATE_ASSETS__).toBe('false');
    },
  );

  it('still serves local assets to test builds used for private captures', () => {
    expect(configFor('test').publicDir).toBe('public');
  });
});
