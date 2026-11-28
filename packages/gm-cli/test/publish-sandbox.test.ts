import { mkdirSync, readFileSync } from 'node:fs';
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
