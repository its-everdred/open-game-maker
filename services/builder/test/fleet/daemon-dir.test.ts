import { chmod, mkdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { materializeCodexHome, renderInputFor } from '../../src/fleet/daemon-dir.js';
import { daemonPaths } from '../../src/fleet/secrets.js';
import { cleanupHomes, fleetEnv, liveRow, tempHome } from './helpers.js';

afterEach(cleanupHomes);

describe('shared Codex auth', () => {
  async function setup() {
    const home = await tempHome();
    const row = liveRow(1);
    const env = fleetEnv(home);
    const input = renderInputFor(row, daemonPaths(home, row.slug), env, 'feature', [row]);
    const shared = join(home, '.config/ogm/codex-gamebuilder/auth.json');
    await rm(shared);
    return { home, input, shared };
  }

  it('links daemons directly to a symlinked regular target and upgrades an existing link', async () => {
    const { home, input, shared } = await setup();
    const target = join(home, 'account-auth');
    await writeFile(target, 'private', { mode: 0o600 });
    await symlink(target, shared);
    await mkdir(input.codexHome!, { recursive: true });
    await symlink(shared, join(input.codexHome!, 'auth.json'));
    await materializeCodexHome(input, shared);
    expect(await readlink(join(input.codexHome!, 'auth.json'))).toBe(target);
    await rm(join(input.codexHome!, 'auth.json'));
    await symlink(join(home, 'missing'), join(input.codexHome!, 'auth.json'));
    await expect(materializeCodexHome(input, shared)).rejects.toThrow(/Codex auth link points to/);
  });

  it('rejects a target owned by another user', async () => {
    const { input, shared } = await setup();
    await writeFile(shared, 'private', { mode: 0o600 });
    const uid = process.getuid!();
    const getuid = vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);
    try {
      await expect(materializeCodexHome(input, shared)).rejects.toThrow(/owned by the current user/);
    } finally {
      getuid.mockRestore();
    }
  });

  it('rejects dangling links, directories and insecure targets', async () => {
    for (const kind of ['dangling', 'directory', 'directory link', 'insecure mode']) {
      const { home, input, shared } = await setup();
      const target = join(home, 'target');
      if (kind === 'directory') await mkdir(shared);
      if (kind === 'directory link') {
        await mkdir(target);
        await symlink(target, shared);
      }
      if (kind === 'dangling') await symlink(target, shared);
      if (kind === 'insecure mode') {
        await writeFile(shared, 'private');
        await chmod(shared, 0o644);
      }
      const reason = kind === 'dangling' ? /is missing/ : kind === 'insecure mode' ? /mode 0600/ : /is not a file/;
      await expect(materializeCodexHome(input, shared)).rejects.toThrow(reason);
    }
  });
});
