import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { liveWorkspaceReady, grantedLiveWorkspace } from '../../src/previews/live-workspace.js';
import { createHash } from 'node:crypto';

it('requires a completed generation under the granted workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'live-workspace-'));
  try {
    const workspace = join(root, 'workspace');
    const live = join(workspace, 'games/demo/.gm/live');
    const id = '11111111-1111-1111-1111-111111111111';
    await mkdir(join(live, 'versions', id, 'design'), { recursive: true });
    await writeFile(join(live, 'versions', id, 'index.html'), '<title>Demo</title>');
    await writeFile(join(live, 'versions', id, 'design/design.json'), '{}');
    expect(await liveWorkspaceReady(workspace, 'games/demo')).toBe(false);
    await symlink(`versions/${id}`, join(live, 'current'));
    expect(await liveWorkspaceReady(workspace, 'games/demo')).toBe(true);
    expect(await liveWorkspaceReady(workspace, '../outside')).toBe(false);
    await mkdir(join(workspace, 'games/linked/.gm'), { recursive: true });
    await symlink(live, join(workspace, 'games/linked/.gm/live'));
    expect(await liveWorkspaceReady(workspace, 'games/linked')).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('resolves only a unique host-granted workspace for a live verdict', async () => {
  const home = await mkdtemp(join(tmpdir(), 'live-grant-'));
  try {
    const workspace = join(home, 'workspace');
    const repo = 'example/games';
    const directory = join(home, '.config/ogm/preview-repos', createHash('sha256').update(repo).digest('hex'));
    await mkdir(join(directory, 'grants'), { recursive: true });
    await mkdir(workspace);
    await writeFile(join(directory, 'secret'), 'secret');
    const grant = join(directory, 'grants', `${createHash('sha256').update(workspace).digest('hex')}.json`);
    await writeFile(
      grant,
      JSON.stringify({ repo, ticket: '12', game: 'demo', workspace, grant: '11111111-1111-1111-1111-111111111111' }),
    );
    expect(await grantedLiveWorkspace(repo, '12', 'demo', home)).toBe(workspace);
    expect(await grantedLiveWorkspace(repo, '13', 'demo', home)).toBeNull();
    await rm(grant);
    expect(await grantedLiveWorkspace(repo, '12', 'demo', home)).toBeNull();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
