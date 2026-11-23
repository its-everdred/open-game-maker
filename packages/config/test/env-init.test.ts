import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const binPath = join(packageRoot, 'bin', 'ogm-env-init.mjs');
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync('/tmp/ogm-config-test-');
  temporaryDirectories.push(directory);
  return directory;
}

function runInitializer(home: string, ...args: string[]) {
  return runInitializerWithEnvironment(home, {}, ...args);
}

function runInitializerWithEnvironment(home: string, environment: Record<string, string>, ...args: string[]) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment, HOME: home },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ogm-env-init', () => {
  it('creates a private unit file with generated secrets and no secret output', () => {
    const home = temporaryDirectory();
    const result = runInitializer(home, 'api');
    const envPath = join(home, '.config', 'ogm', 'env', 'api.env');

    expect(result.status, result.stderr).toBe(0);
    const contents = readFileSync(envPath, 'utf8');
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(contents).toContain('OGM_API_PORT=');
    expect(contents).toMatch(/^OGM_BLOB_SIGNING_KEY=[a-f0-9]{64}$/m);
    expect(result.stdout).toContain(`wrote ${envPath}`);
    expect(result.stdout).not.toMatch(/[a-f0-9]{64}/);
  });

  it('refuses to overwrite an existing unit file', () => {
    const home = temporaryDirectory();
    expect(runInitializer(home, 'api').status).toBe(0);
    const envPath = join(home, '.config', 'ogm', 'env', 'api.env');
    const before = readFileSync(envPath, 'utf8');

    const result = runInitializer(home, 'api');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refusing to overwrite');
    expect(readFileSync(envPath, 'utf8')).toBe(before);
  });

  it('refuses a target directory inside the repository', () => {
    const home = temporaryDirectory();
    const result = runInitializer(home, 'api', '--dir', join(repositoryRoot, '.aiur-runtime', 'tmp', 'env-init-test'));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refusing to write inside the repository');
  });

  it('reuses shared secrets from an existing unit file', () => {
    const home = temporaryDirectory();
    const directory = join(home, '.config', 'ogm', 'env');
    expect(runInitializer(home, 'api').status).toBe(0);
    const apiPath = join(directory, 'api.env');
    const sharedSecret = /^OGM_WS_TOKEN_SECRET=(.*)$/m.exec(readFileSync(apiPath, 'utf8'))?.[1];
    expect(sharedSecret).toMatch(/^[a-f0-9]{64}$/);

    const result = runInitializer(home, 'rooms');
    const roomsContents = readFileSync(join(directory, 'rooms.env'), 'utf8');

    expect(result.status, result.stderr).toBe(0);
    expect(roomsContents).toContain(`OGM_WS_TOKEN_SECRET=${sharedSecret}`);
    expect(result.stdout).not.toContain(sharedSecret);
  });

  it.each(['intake', 'drive-sync'])('creates %s files with their shared rows', (unit) => {
    const home = temporaryDirectory();
    const result = runInitializer(home, unit);
    const contents = readFileSync(join(home, '.config', 'ogm', 'env', `${unit}.env`), 'utf8');

    expect(result.status, result.stderr).toBe(0);
    expect(contents).toContain('OGM_PUBLIC_ORIGIN=');
    expect(contents).toContain('OGM_ASSETS_ROOT=');
    expect(contents).toMatch(/^OGM_WS_TOKEN_SECRET=[a-f0-9]{64}$/m);
    if (unit === 'intake') expect(contents).toContain('OGM_STATE_DIR=');
  });

  it('creates a web file with deploy origins and all instance assets enabled', () => {
    const home = temporaryDirectory();
    const result = runInitializer(home, 'web');
    const contents = readFileSync(join(home, '.config', 'ogm', 'env', 'web.env'), 'utf8');

    expect(result.status, result.stderr).toBe(0);
    expect(contents).toBe(
      'OGM_PUBLIC_APP_ORIGIN=\nOGM_APP_ALIAS_ORIGINS=\nOGM_INSTANCE_ALL_ASSETS=1\nVITE_GAMES_ORIGIN=\nVITE_API_ORIGIN=\nVITE_ICE_URLS=\nVITE_INSTANCE_LOGO_URL=\n',
    );
  });

  it('creates a repair file with its existing shared API and games settings', () => {
    const home = temporaryDirectory();
    const result = runInitializer(home, 'repair');
    const contents = readFileSync(join(home, '.config', 'ogm', 'env', 'repair.env'), 'utf8');

    expect(result.status, result.stderr).toBe(0);
    expect(contents).toContain('OGM_API_INTERNAL_URL=');
    expect(contents).toContain('OGM_GAMES_ROOT=');
    expect(contents).toMatch(/^OGM_INTERNAL_TOKEN=[a-f0-9]{64}$/m);
  });

  it('refuses a repository target when Git is unavailable', () => {
    const home = temporaryDirectory();
    const result = runInitializerWithEnvironment(
      home,
      { PATH: '' },
      'api',
      '--dir',
      join(repositoryRoot, '.aiur-runtime', 'tmp', 'env-init-without-git'),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refusing to write inside the repository');
  });

  it('repairs the file mode when force-writing an existing file', () => {
    const home = temporaryDirectory();
    expect(runInitializer(home, 'api').status).toBe(0);
    const envPath = join(home, '.config', 'ogm', 'env', 'api.env');
    chmodSync(envPath, 0o644);
    writeFileSync(envPath, 'OGM_WS_TOKEN_SECRET=reused-secret-at-least-16\n');

    const result = runInitializer(home, 'api', '--force');

    expect(result.status, result.stderr).toBe(0);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it('refuses to force-write through a symbolic link', () => {
    const home = temporaryDirectory();
    const directory = join(home, '.config', 'ogm', 'env');
    const victim = join(home, 'victim.env');
    const envPath = join(directory, 'api.env');
    mkdirSync(directory, { recursive: true });
    writeFileSync(victim, 'keep-me\n');
    symlinkSync(victim, envPath);

    const result = runInitializer(home, 'api', '--force');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refusing to overwrite symbolic link');
    expect(readFileSync(victim, 'utf8')).toBe('keep-me\n');
  });

  it('preserves an existing file when an atomic force-write cannot start', () => {
    const home = temporaryDirectory();
    expect(runInitializer(home, 'api').status).toBe(0);
    const directory = join(home, '.config', 'ogm', 'env');
    const envPath = join(directory, 'api.env');
    const before = 'OGM_API_PORT=9999\n';
    writeFileSync(envPath, before);
    chmodSync(directory, 0o500);

    let result;
    try {
      result = runInitializer(home, 'api', '--force');
    } finally {
      chmodSync(directory, 0o700);
    }

    expect(result.status).toBe(2);
    expect(readFileSync(envPath, 'utf8')).toBe(before);
  });
});
