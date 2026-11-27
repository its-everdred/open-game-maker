import { execFileSync } from 'node:child_process';

import { expect, it } from 'vitest';

import { createLocalInstance } from '../../../../apps/web/e2e/support/local-instance.js';
import { localProvisioner } from './local-provisioner.js';

it('refuses a checkout whose origin is not the temporary bare repository', async () => {
  const instance = createLocalInstance();
  try {
    execFileSync('git', [
      '-C',
      instance.checkout,
      'remote',
      'set-url',
      'origin',
      'https://example.test/instance/games',
    ]);
    await expect(
      localProvisioner(instance.checkout, instance.bare).provision({
        id: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e20',
        title: 'Test game',
        slug: 'test-game',
        visibility: 'private',
      }),
    ).rejects.toThrow('instance remote is not the temporary bare repository');
  } finally {
    instance.cleanup();
  }
}, 120_000);
