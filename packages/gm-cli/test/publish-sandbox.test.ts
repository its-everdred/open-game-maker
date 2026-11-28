import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { publishSandboxEnv, writePublishSandbox } from '../src/publish-sandbox.js';
import { tempDir } from './helpers.js';

it('constructs a network-off profile input without host credentials in the game environment', () => {
  const root = tempDir('publish-sandbox-');
  const profile = join(root, 'profile');
  mkdirSync(profile);
  writePublishSandbox(profile, '/sandbox/user', '/sandbox/user/publish', '/sandbox/user/publish/this-game');
  const config = readFileSync(join(profile, 'config.toml'), 'utf8');
  expect(config).toContain('"/sandbox/user/.config/ogm" = "deny"');
  expect(config).toContain('"/sandbox/user/.cache/ogm/assets" = "deny"');
  expect(config).toContain(`${JSON.stringify(profile)} = "deny"`);
  expect(config).toContain('"/sandbox/user/publish" = "deny"');
  expect(config).toContain('"/sandbox/user/publish/this-game" = "write"');
  expect(config).toContain('":slash_tmp" = "deny"');
  const env = publishSandboxEnv({ PATH: '/bin', GITHUB_TOKEN: 'private', OGM_INTERNAL_TOKEN: 'private' }, profile);
  expect(env).toEqual({ PATH: '/bin', CODEX_HOME: profile, GIT_TERMINAL_PROMPT: '0' });
});

it('runs an install in the real publish sandbox when sandboxing is available', ({ skip }) => {
  const root = tempDir('publish-install-integration-');
  const probeHome = join(root, 'probe');
  mkdirSync(probeHome);
  const probe = spawnSync('codex', ['sandbox', '-C', root, '--', '/bin/true'], {
    env: { ...process.env, CODEX_HOME: probeHome },
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (probe.status !== 0) skip();

  const workRoot = join(root, 'publish');
  const profile = join(workRoot, 'job', 'sandbox-profile');
  const checkout = join(workRoot, 'job', 'game');
  const assets = join(workRoot, 'job', 'assets');
  mkdirSync(profile, { recursive: true });
  mkdirSync(checkout, { recursive: true });
  mkdirSync(assets, { recursive: true });
  const pnpm = join(checkout, 'pnpm');
  writeFileSync(
    pnpm,
    '#!/bin/sh\n[ "$1" = install ] || exit 1\n[ ! -r "$CODEX_HOME/config.toml" ] || exit 2\ntouch installed\n',
  );
  chmodSync(pnpm, 0o755);
  writePublishSandbox(profile, root, workRoot, checkout, [], [assets]);
  const result = spawnSync(
    'codex',
    ['sandbox', '-P', 'gamebuilder', '--sandbox-state-disable-network', '-C', checkout, '--', pnpm, 'install'],
    { env: publishSandboxEnv({ ...process.env, HOME: root }, profile), encoding: 'utf8', timeout: 30_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(existsSync(join(checkout, 'installed'))).toBe(true);
});

it('hides the install profile through its denied publish parent without a nested mount', () => {
  const root = tempDir('publish-install-sandbox-');
  const workRoot = join(root, 'publish');
  const profile = join(workRoot, 'job', 'sandbox-profile');
  const checkout = join(workRoot, 'job', 'game');
  const assets = join(workRoot, 'job', 'assets');
  mkdirSync(profile, { recursive: true });
  writePublishSandbox(profile, root, workRoot, checkout, [], [assets]);
  const config = readFileSync(join(profile, 'config.toml'), 'utf8');
  expect(config).toContain(`${JSON.stringify(workRoot)} = "deny"`);
  expect(config).not.toContain(`${JSON.stringify(profile)} = "deny"`);
  expect(config).toContain(`${JSON.stringify(checkout)} = "write"`);
  expect(config).toContain(`${JSON.stringify(assets)} = "read"`);
});
