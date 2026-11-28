import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { FleetEnv } from './types.js';

export type DaemonPaths = {
  dir: string;
  workspaces: string;
  envFile: string;
  secretsDir: string;
  clientToken: string;
  readToken: string;
  hookSecret: string;
};

export function daemonPaths(home: string, slug: string): DaemonPaths {
  const dir = join(home, '.local/share/ogm/daemons', slug);
  const secretsDir = join(home, '.config/ogm/daemons', slug);
  return {
    dir,
    workspaces: join(dir, 'workspaces'),
    envFile: join(home, '.config/ogm/env', `ogm-aiur@${slug}.env`),
    secretsDir,
    clientToken: join(secretsDir, 'client-token'),
    readToken: join(secretsDir, 'read-token'),
    hookSecret: join(secretsDir, 'hook-secret'),
  };
}

export function isRegisteredDaemon(home: string, row: { slug: string; checkoutPath: string }): boolean {
  return row.checkoutPath !== daemonPaths(home, row.slug).dir;
}

export async function writeAtomic(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, content, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

export async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

// Writes the unit's env file and the hook secret. The cookie and hook secret are generated once per slug and
// reused afterwards, so a restart keeps talking to the same node. Only the names below ever reach the file.
export async function writeDaemonSecrets(paths: DaemonPaths, env: FleetEnv, codexHome: string): Promise<void> {
  if (!env.builderBotToken) {
    throw new Error('OGM_BUILDER_BOT_TOKEN is not set');
  }

  const existing = parseEnv((await readIfPresent(paths.envFile)) ?? '');
  const cookie = existing.AIUR_ERLANG_COOKIE ?? randomBytes(32).toString('hex');

  if ((await readIfPresent(paths.hookSecret)) === undefined) {
    await writeAtomic(paths.hookSecret, randomBytes(32).toString('base64url'), 0o600);
  }

  const lines = [
    `AIUR_ERLANG_COOKIE=${cookie}`,
    `GITHUB_TOKEN=${env.builderBotToken}`,
    `CODEX_HOME=${codexHome}`,
    'AIUR_SECRETS_FROM_ENV=1',
    'AIUR_GITHUB_ALLOW_PAT=1',
    `OGM_HOOK_SECRET_FILE=${paths.hookSecret}`,
  ];
  if (env.apiPort !== undefined) lines.push(`OGM_INTERNAL_URL=http://127.0.0.1:${env.apiPort}`);
  await writeAtomic(paths.envFile, `${lines.join('\n')}\n`, 0o600);
}

export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const index = line.indexOf('=');
    if (index > 0) values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}
