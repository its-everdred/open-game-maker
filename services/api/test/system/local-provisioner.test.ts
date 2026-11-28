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

it('updates only the temporary bare repository when origin has a different push URL', async () => {
  const instance = createLocalInstance();
  try {
    const other = `${instance.root}/other.git`;
    execFileSync('git', ['init', '--bare', '--initial-branch=main', other], { stdio: 'ignore' });
    execFileSync('git', ['-C', instance.checkout, 'remote', 'set-url', '--push', 'origin', other]);
    const result = await localProvisioner(instance.checkout, instance.bare).provision({
      id: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e20',
      title: 'Test game',
      slug: 'test-game',
      visibility: 'private',
    });
    expect(
      execFileSync('git', ['--git-dir', instance.bare, 'show', `main:${result.path}/package.json`], {
        encoding: 'utf8',
      }),
    ).toContain('name');
    expect(() =>
      execFileSync('git', ['--git-dir', other, 'rev-parse', '--verify', 'main'], { stdio: 'ignore' }),
    ).toThrow();
  } finally {
    instance.cleanup();
  }
}, 120_000);
