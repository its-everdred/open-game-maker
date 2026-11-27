import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { createLocalInstance } from './local-instance';

it('creates a disposable local instance repository and removes it', () => {
  const instance = createLocalInstance();
  try {
    expect(
      execFileSync('git', ['-C', instance.checkout, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim(),
    ).toBe(instance.bare);
    writeFileSync(join(instance.checkout, 'game.txt'), 'test game');
    execFileSync('git', ['-C', instance.checkout, 'add', 'game.txt']);
    execFileSync(
      'git',
      [
        '-C',
        instance.checkout,
        '-c',
        'user.name=System Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '-m',
        'Add game',
      ],
      { stdio: 'ignore' },
    );
    execFileSync('git', [
      '-C',
      instance.bare,
      '-c',
      'protocol.allow=never',
      '-c',
      'protocol.file.allow=always',
      'fetch',
      '--quiet',
      '--no-tags',
      instance.checkout,
      'main:refs/heads/main',
    ]);
    expect(execFileSync('git', ['--git-dir', instance.bare, 'show', 'main:game.txt'], { encoding: 'utf8' })).toBe(
      'test game',
    );
  } finally {
    instance.cleanup();
  }
  expect(existsSync(instance.root)).toBe(false);
}, 120_000);
