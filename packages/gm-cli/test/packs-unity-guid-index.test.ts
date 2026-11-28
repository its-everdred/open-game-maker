import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { indexUnityGuids } from '../src/packs/unity/guid-index.js';

it('indexes sidecars and rejects ambiguous GUIDs and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gm-unity-index-'));
  try {
    await mkdir(join(root, 'models'));
    const guid = 'a'.repeat(32);
    await writeFile(join(root, 'models', 'roof.fbx.meta'), `fileFormatVersion: 2\r\nguid: ${guid}\r\n`);
    expect((await indexUnityGuids(root)).get(guid)).toBe(join(root, 'models', 'roof.fbx'));
    await writeFile(join(root, 'duplicate.meta'), `guid: ${guid}\n`);
    await expect(indexUnityGuids(root)).rejects.toThrow('duplicate Unity GUID');
    await rm(join(root, 'duplicate.meta'));
    await symlink(join(root, 'models'), join(root, 'linked'));
    await expect(indexUnityGuids(root)).rejects.toThrow('symbolic link');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
