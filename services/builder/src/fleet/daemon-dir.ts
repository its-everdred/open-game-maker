import { randomUUID } from 'node:crypto';
import { mkdir, readlink, realpath, rename, stat, symlink, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderDaemonFiles } from '@ogm/game-repo-template';

import { renderAiurConfig } from '../policy/render.js';
import { renderCodexProfile } from '../policy/profile.js';
import type { RenderInput } from '../policy/types.js';
import { daemonPaths, writeAtomic, type DaemonPaths } from './secrets.js';
import type { DaemonRow, FleetEnv, JobKind } from './types.js';

export type DaemonFiles = { hooks: string; prompt: string };
export type DaemonFilesProvider = (row: DaemonRow) => Promise<DaemonFiles>;

// Each daemon renders its own game's hook and prompt: the hook checks the instance repo out sparsely (this game's
// folder plus `packages/` and the root config) and the prompt carries the game-scope rules.
export function gameRepoDaemonFiles(env: FleetEnv): DaemonFilesProvider {
  const helper = fileURLToPath(new URL('../../../../packages/gm-cli/dist/publish-assets-helper.js', import.meta.url));
  return async (row) =>
    renderDaemonFiles({
      gameSlug: row.slug,
      publishHost: {
        helper,
        assetsRoot: env.assetsLocalDir,
        blobRoot: env.blobRoot ?? join(env.home, '.local/share/ogm/blobs'),
      },
    });
}

function physicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function aiurRoot(env: FleetEnv): string {
  return env.aiurRoot ?? join(env.home, 'github/aiur');
}

export function codexHomeFor(env: FleetEnv, slug: string): string {
  return join(env.codexHomeRoot ?? join(env.home, '.config/ogm/codex'), slug);
}

export function codexAuthFor(env: FleetEnv): string {
  return env.codexAuthPath ?? join(env.home, '.config/ogm/codex-gamebuilder/auth.json');
}

export function renderInputFor(
  row: DaemonRow,
  paths: DaemonPaths,
  env: FleetEnv,
  kind: JobKind,
  rows: DaemonRow[],
): RenderInput {
  const stores = [env.assetsLocalDir, env.blobRoot ?? join(env.home, '.local/share/ogm/blobs')];
  const workspaceRoots = [resolve(paths.workspaces), resolve(physicalPath(paths.workspaces))];
  for (const store of stores.flatMap((path) => [resolve(path), resolve(physicalPath(path))])) {
    if (
      workspaceRoots.some(
        (workspace) =>
          store === workspace || store.startsWith(`${workspace}${sep}`) || workspace.startsWith(`${store}${sep}`),
      )
    ) {
      throw new Error('configured asset or blob store overlaps a daemon workspace');
    }
  }
  return {
    repo: row.repo,
    // A game daemon's label prefix is its game slug, so aiur only reads and transitions this game's labels.
    labelPrefix: row.slug,
    workspaceRoot: paths.workspaces,
    port: row.port,
    intakeLogin: env.intakeLogin,
    botAccount: env.builderBotLogin,
    kind,
    maxConcurrentAgents: row.maxConcurrentAgents,
    denyReadRoots: [
      env.assetsLocalDir,
      physicalPath(env.assetsLocalDir),
      env.blobRoot ?? join(env.home, '.local/share/ogm/blobs'),
      physicalPath(env.blobRoot ?? join(env.home, '.local/share/ogm/blobs')),
      ...rows.filter((other) => other.slug !== row.slug).map((other) => daemonPaths(env.home, other.slug).workspaces),
    ],
    instanceId: row.slug,
    codexHome: codexHomeFor(env, row.slug),
  };
}

export async function materialize(
  paths: DaemonPaths,
  input: RenderInput,
  files: DaemonFiles,
  authPath: string,
): Promise<void> {
  await mkdir(join(paths.dir, '.aiur'), { recursive: true, mode: 0o700 });
  await mkdir(paths.workspaces, { recursive: true, mode: 0o700 });
  await writeAtomic(join(paths.dir, '.aiur/config'), renderAiurConfig(input), 0o600);
  await writeAtomic(join(paths.dir, '.aiur/hooks'), files.hooks, 0o600);
  await writeAtomic(join(paths.dir, '.aiur/prompt.md'), files.prompt, 0o600);
  await materializeCodexHome(input, authPath);
}

export async function materializeCodexHome(input: RenderInput, authPath: string): Promise<void> {
  const codexHome = input.codexHome;
  if (!codexHome) throw new Error('per-daemon codexHome is required');
  const resolvedAuth = await requireFile(authPath, 'shared Codex auth');
  await writeAtomic(join(codexHome, 'config.toml'), renderCodexProfile(input), 0o600);
  await linkSharedAuth(codexHome, resolvedAuth);
}

async function linkSharedAuth(codexHome: string, authPath: string): Promise<void> {
  const link = join(codexHome, 'auth.json');
  let current: string;
  try {
    current = await readlink(link);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      await symlink(authPath, link);
      return;
    }
    if (isNodeError(error) && error.code === 'EINVAL') {
      throw new Error(`Codex auth path is not a symlink: ${link}`, { cause: error });
    }
    throw error;
  }
  if (current === authPath) return;
  const resolved = await realpath(link).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (resolved !== authPath) throw new Error(`Codex auth link points to ${current}; expected ${authPath}`);
  const temporary = `${link}.${randomUUID()}`;
  await symlink(authPath, temporary);
  try {
    await rename(temporary, link);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    });
  }
}

async function requireFile(path: string, label: string): Promise<string> {
  try {
    const resolved = await realpath(path);
    const target = await stat(resolved);
    if (!target.isFile()) throw new Error(`${label} is not a file: ${path}`);
    if ((target.mode & 0o7777) !== 0o600) throw new Error(`${label} must have mode 0600: ${path}`);
    if (typeof process.getuid !== 'function' || target.uid !== process.getuid())
      throw new Error(`${label} must be owned by the current user: ${path}`);
    return resolved;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT')
      throw new Error(`${label} is missing: ${path}`, { cause: error });
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
