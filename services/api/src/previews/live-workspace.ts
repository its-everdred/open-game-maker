import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { liveGeneration, openLiveFile } from '@ogm/games-host/live-files';

/** Resolve a unique, host-granted workspace for an active live review. */
export async function grantedLiveWorkspace(
  repo: string,
  ticket: string,
  game: string,
  home = homedir(),
): Promise<string | null> {
  const root = join(home, '.config/ogm/preview-repos', createHash('sha256').update(repo).digest('hex'));
  if (!(await readFile(join(root, 'secret'), 'utf8').catch(() => '')).trim()) return null;
  const directory = join(root, 'grants');
  const matches: string[] = [];
  for (const file of await readdir(directory).catch(() => [] as string[])) {
    if (!/^[0-9a-f]{64}\.json$/u.test(file)) continue;
    const row = await readFile(join(directory, file), 'utf8')
      .then(
        (text) =>
          JSON.parse(text) as {
            repo?: unknown;
            ticket?: unknown;
            game?: unknown;
            grant?: unknown;
            workspace?: unknown;
          },
      )
      .catch(() => null);
    if (
      !row ||
      row.repo !== repo ||
      row.ticket !== ticket ||
      row.game !== game ||
      typeof row.grant !== 'string' ||
      !/^[0-9a-f-]{36}$/u.test(row.grant) ||
      typeof row.workspace !== 'string' ||
      !row.workspace.startsWith('/') ||
      `${createHash('sha256').update(row.workspace).digest('hex')}.json` !== file ||
      (await realpath(row.workspace).catch(() => '')) !== row.workspace
    )
      continue;
    matches.push(row.workspace);
  }
  return matches.length === 1 ? matches[0]! : null;
}

/** Only a completed generation inside the granted workspace may back a live review. */
export async function liveWorkspaceReady(workspace: string, gamePath: string): Promise<boolean> {
  const gameDirectory = resolve(workspace, gamePath);
  const live = join(gameDirectory, '.gm', 'live');
  if (!gameDirectory.startsWith(workspace + sep) || (await realpath(live).catch(() => '')) !== live) return false;
  const version = await liveGeneration(live);
  if (!version) return false;
  for (const path of ['index.html', 'design/design.json']) {
    const file = await openLiveFile(live, path, version);
    if (!file) return false;
    await file.close();
  }
  return true;
}
