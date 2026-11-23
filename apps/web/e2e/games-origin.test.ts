// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  readApiOrigin,
  readAppAliasOrigins,
  readGamesOrigin,
  readInstanceAllAssets,
  readPublicAppOrigin,
} from '../tools/games-origin.mjs';

async function envDir(contents?: string, rooms?: string, api?: string, games?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ogm-web-env-'));
  if (contents !== undefined) await writeFile(join(dir, 'web.env'), contents);
  if (rooms !== undefined) await writeFile(join(dir, 'rooms.env'), rooms);
  if (api !== undefined) await writeFile(join(dir, 'api.env'), api);
  if (games !== undefined) await writeFile(join(dir, 'games.env'), games);
  return dir;
}

async function readFrom(contents?: string, rooms?: string): Promise<() => string> {
  const dir = await envDir(contents, rooms);
  return () => readGamesOrigin(dir);
}

function runCli(dir: string, tool = 'games-origin.mjs', args: string[] = []) {
  return spawnSync(process.execPath, [fileURLToPath(new URL(`../tools/${tool}`, import.meta.url)), ...args], {
    encoding: 'utf8',
    env: { OGM_ENV_DIR: dir },
  });
}

// deploy.sh must never fall back to the 127.0.0.1 default, which a phone cannot reach.
describe('deploy games origin', () => {
  it('reads the last VITE_GAMES_ORIGIN and nothing else', async () => {
    const read = await readFrom(
      'OTHER=secret\nVITE_GAMES_ORIGIN=https://old.example:1\nVITE_GAMES_ORIGIN="https://games.example:10000/"\n',
    );

    expect(read()).toBe('https://games.example:10000');
  });

  it('refuses a missing file or a blank value', async () => {
    expect(await readFrom()).toThrow(/web\.env is missing/);
    expect(await readFrom('VITE_GAMES_ORIGIN=\n')).toThrow(/not set/);
  });

  it('refuses an http origin or one with a path, which the deployed app cannot frame', async () => {
    expect(await readFrom('VITE_GAMES_ORIGIN=http://127.0.0.1:10000\n')).toThrow(/https origin/);
    expect(await readFrom('VITE_GAMES_ORIGIN=https://games.example/play\n')).toThrow(/https origin/);
    expect(await readFrom('VITE_GAMES_ORIGIN=games.example\n')).toThrow(/not a URL/);
  });

  it('never puts another line of the file into the error', async () => {
    const read = await readFrom('OGM_SECRET=do-not-print\n');

    expect(read).toThrow(/not set/);
    expect(read).not.toThrow(/do-not-print/);
  });

  it('refuses a web.env origin rooms would not accept draft URLs from', async () => {
    const web = 'VITE_GAMES_ORIGIN=https://games.example:10000\n';

    expect(await readFrom(web, 'OGM_GAMES_ORIGIN=https://new.example:10000\n')).toThrow(
      /differs from OGM_GAMES_ORIGIN/,
    );
    expect((await readFrom(web, 'OGM_GAMES_ORIGIN=https://games.example:10000/\n'))()).toBe(
      'https://games.example:10000',
    );
    expect((await readFrom(web, 'OGM_GAMES_ORIGIN=\n'))()).toBe('https://games.example:10000');
  });

  // deploy.sh captures stdout and relies on a non-zero exit to stop before building.
  it('prints only the origin from the command line, and fails loudly without one', async () => {
    const ok = runCli(await envDir('VITE_GAMES_ORIGIN=https://games.example:10000\n'));
    expect([ok.status, ok.stdout, ok.stderr]).toEqual([0, 'https://games.example:10000\n', '']);

    const missing = runCli(await envDir());
    expect([missing.status, missing.stdout]).toEqual([1, '']);
    expect(missing.stderr).toMatch(/^deploy: VITE_GAMES_ORIGIN is not set/);
  });

  // The guard only helps if deploy.sh calls it before building and hands its output to the build.
  it('stops deploy.sh before the build and bakes the origin into it', async () => {
    const script = fileURLToPath(new URL('../tools/deploy.sh', import.meta.url));
    const run = spawnSync('bash', [script, '--dry-run'], {
      encoding: 'utf8',
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, OGM_ENV_DIR: await envDir() },
    });

    expect([run.status, run.stdout]).toEqual([1, '']);
    expect(run.stderr).toMatch(/^deploy: VITE_GAMES_ORIGIN is not set/);
    expect(readFileSync(script, 'utf8')).toContain(
      'VITE_GAMES_ORIGIN="$GAMES_ORIGIN" VITE_INSTANCE_LOGO_URL="$INSTANCE_LOGO_URL"',
    );
  });
});

describe('instance asset mode', () => {
  it('defaults to every host-library asset and accepts the config boolean forms', async () => {
    expect(readInstanceAllAssets(await envDir(''))).toBe(true);
    expect(readInstanceAllAssets(await envDir('OGM_INSTANCE_ALL_ASSETS=1\n'))).toBe(true);
    expect(readInstanceAllAssets(await envDir('OGM_INSTANCE_ALL_ASSETS=true\n'))).toBe(true);
    expect(readInstanceAllAssets(await envDir('OGM_INSTANCE_ALL_ASSETS=0\n'))).toBe(false);
    expect(readInstanceAllAssets(await envDir('OGM_INSTANCE_ALL_ASSETS=false\n'))).toBe(false);
  });

  it('rejects an invalid value without echoing another web.env line', async () => {
    const dir = await envDir('OGM_SECRET=do-not-print\nOGM_INSTANCE_ALL_ASSETS=sometimes\n');

    expect(() => readInstanceAllAssets(dir)).toThrow(/expected true, false, 1, or 0/);
    expect(() => readInstanceAllAssets(dir)).not.toThrow(/do-not-print/);
  });

  it('prints the resolved mode for deploy.sh', async () => {
    const enabled = runCli(await envDir(''), 'games-origin.mjs', ['--instance-all-assets']);
    const disabled = runCli(await envDir('OGM_INSTANCE_ALL_ASSETS=0\n'), 'games-origin.mjs', ['--instance-all-assets']);

    expect([enabled.status, enabled.stdout, enabled.stderr]).toEqual([0, '1\n', '']);
    expect([disabled.status, disabled.stdout, disabled.stderr]).toEqual([0, '0\n', '']);
  });
});

// The /api and /auth proxies are written at deploy time so the repo never names the host (#317).
describe('deploy API origin', () => {
  const games = 'VITE_GAMES_ORIGIN=https://games.example:10000\nOGM_PUBLIC_APP_ORIGIN=https://makeopen.games\n';

  it('refuses a missing, http or pathed VITE_API_ORIGIN, which would ship an app that cannot sign in', async () => {
    for (const [contents, error] of [
      [games, /VITE_API_ORIGIN is not set/],
      [`${games}VITE_API_ORIGIN=http://api.example:8443\n`, /https origin/],
      [`${games}VITE_API_ORIGIN=https://api.example:8443/api\n`, /https origin/],
    ] as const) {
      const dir = await envDir(contents);
      expect(() => readApiOrigin(dir)).toThrow(error);
    }
  });

  it('refuses a web.env origin the API does not serve auth on', async () => {
    const web = `${games}VITE_API_ORIGIN=https://api.example:8443\n`;

    expect(() => readApiOrigin('/nonexistent')).toThrow(/web\.env is missing/);
    const stale = await envDir(web, undefined, 'OGM_PUBLIC_ORIGIN=https://old.example:8443\n');
    expect(() => readApiOrigin(stale)).toThrow(/differs from OGM_PUBLIC_ORIGIN/);
    const same = await envDir(web, undefined, 'OGM_PUBLIC_ORIGIN=https://api.example:8443/\n');
    expect(readApiOrigin(same)).toBe('https://api.example:8443');
  });

  it('prints the whole _redirects file from the command line, and fails loudly without an origin', async () => {
    const ok = runCli(await envDir(`${games}VITE_API_ORIGIN=https://api.example:8443\n`), 'redirects.mjs');
    expect([ok.status, ok.stderr]).toEqual([0, '']);
    expect(ok.stdout).toBe(
      'https://ogm2000.netlify.app/*  https://makeopen.games/:splat  301!\n/api/*  https://api.example:8443/api/:splat  200\n/auth/*  https://api.example:8443/auth/:splat  200\n/proto  /proto/  301\n/proto/*  /proto/:splat  200\n/*  /index.html  200\n',
    );

    const missing = runCli(await envDir(games), 'redirects.mjs');
    expect([missing.status, missing.stdout]).toEqual([1, '']);
    expect(missing.stderr).toMatch(/^deploy: VITE_API_ORIGIN is not set/);
  });

  it('stops deploy.sh before the build when the API origin is missing', async () => {
    const script = fileURLToPath(new URL('../tools/deploy.sh', import.meta.url));
    const run = spawnSync('bash', [script, '--dry-run'], {
      encoding: 'utf8',
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, OGM_ENV_DIR: await envDir(games) },
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^deploy: VITE_API_ORIGIN is not set/m);
  });

  it('prints the generated redirects before checking host-local build inputs', async () => {
    const script = fileURLToPath(new URL('../tools/deploy.sh', import.meta.url));
    const commands = await mkdtemp(join(tmpdir(), 'ogm-web-commands-'));
    await writeFile(join(commands, 'pnpm'), '#!/usr/bin/env bash\nexit 73\n', { mode: 0o755 });
    const run = spawnSync('bash', [script, '--dry-run'], {
      encoding: 'utf8',
      env: {
        PATH: `${commands}:${dirname(process.execPath)}:/usr/bin:/bin`,
        OGM_ENV_DIR: await envDir(`${games}VITE_API_ORIGIN=https://api.example:8443\n`),
      },
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(
      /^deploy: required host-local directory is missing: .*(?:assets-local|scripts\/audio\/\.venv)$/m,
    );
    expect(run.stdout).toBe(
      'games origin: https://games.example:10000 (OGM_APP_ORIGIN in games.env must list this app for frame-ancestors)\n' +
        'instance assets: every host-library asset used by the screens is enabled\n' +
        'https://ogm2000.netlify.app/*  https://makeopen.games/:splat  301!\n' +
        '/api/*  https://api.example:8443/api/:splat  200\n' +
        '/auth/*  https://api.example:8443/auth/:splat  200\n' +
        '/proto  /proto/  301\n' +
        '/proto/*  /proto/:splat  200\n' +
        '/*  /index.html  200\n',
    );
  });
});

describe('public app origin', () => {
  it('reads the custom domain from web.env and rejects missing or unsafe values', async () => {
    expect(readPublicAppOrigin(await envDir('OGM_PUBLIC_APP_ORIGIN=https://makeopen.games/\n'))).toBe(
      'https://makeopen.games',
    );
    expect(() => readPublicAppOrigin('/nonexistent')).toThrow(/web\.env is missing/);
    for (const value of ['http://makeopen.games', 'https://makeopen.games/app']) {
      const dir = await envDir(`OGM_PUBLIC_APP_ORIGIN=${value}\n`);
      expect(() => readPublicAppOrigin(dir)).toThrow(/https origin/);
    }
  });
});

// 2026-11-23: the app also answered on the bare domain, which the games host's frame-ancestors did not list, so every
// game showed Try again on a phone (#1297). The web deploy config names the one app origin; aliases redirect to it.
describe('app domains', () => {
  const web = 'OGM_PUBLIC_APP_ORIGIN=https://app.example\n';

  it('refuses a public app origin the games host, API or rooms would not trust', async () => {
    const framed = await envDir(
      web,
      undefined,
      undefined,
      'OGM_APP_ORIGIN="https://old.example https://app.example/"\n',
    );
    expect(readPublicAppOrigin(framed)).toBe('https://app.example');

    for (const [rooms, api, games, file] of [
      [undefined, undefined, 'OGM_APP_ORIGIN=https://old.example\n', 'games.env'],
      [undefined, 'OGM_APP_ORIGIN=https://old.example\n', undefined, 'api.env'],
      ['OGM_APP_ORIGIN=https://old.example\n', undefined, undefined, 'rooms.env'],
    ] as const) {
      const dir = await envDir(web, rooms, api, games);
      expect(() => readPublicAppOrigin(dir)).toThrow(new RegExp(`${file.replace('.', '\\.')} does not list`));
    }
  });

  it('reads alias origins and refuses unsafe ones or the public origin itself', async () => {
    expect(readAppAliasOrigins(await envDir(web))).toEqual([]);
    const aliases = `${web}OGM_APP_ALIAS_ORIGINS="https://bare.example https://www.bare.example/"\n`;
    expect(readAppAliasOrigins(await envDir(aliases))).toEqual(['https://bare.example', 'https://www.bare.example']);

    for (const [value, error] of [
      ['http://bare.example', /bare https origins/],
      ['https://bare.example/app', /bare https origins/],
      ['bare.example', /not a URL/],
      ['https://app.example', /lists OGM_PUBLIC_APP_ORIGIN itself/],
    ] as const) {
      const dir = await envDir(`${web}OGM_APP_ALIAS_ORIGINS=${value}\n`);
      expect(() => readAppAliasOrigins(dir)).toThrow(error);
    }
  });

  it('redirects every alias to the public app origin in the generated _redirects', async () => {
    const run = runCli(
      await envDir(
        `${web}VITE_API_ORIGIN=https://api.example:8443\nOGM_APP_ALIAS_ORIGINS=https://bare.example\n`,
        undefined,
        undefined,
        'OGM_APP_ORIGIN=https://app.example\n',
      ),
      'redirects.mjs',
    );
    expect([run.status, run.stderr]).toEqual([0, '']);
    expect(run.stdout.split('\n').slice(0, 2)).toEqual([
      'https://ogm2000.netlify.app/*  https://app.example/:splat  301!',
      'https://bare.example/*  https://app.example/:splat  301!',
    ]);
  });
});
