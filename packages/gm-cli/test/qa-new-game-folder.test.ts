import { describe, expect, it } from 'vitest';
import { qaFolderRemovals, removeQaFolder } from '../src/qa-new-game-folder.js';

describe('QA folder removal plan', () => {
  it('removes only leaves within the exact QA folder and refuses incomplete trees', () => {
    const tree = [
      { path: 'games/qa/file.ts', type: 'blob', mode: '100644' },
      { path: 'games/qa/nested', type: 'tree', mode: '040000' },
      { path: 'games/qa/nested/link', type: 'blob', mode: '120000' },
      { path: 'games/qa-other/file.ts', type: 'blob', mode: '100644' },
      { path: '.gm/scope/s_123.json', type: 'blob', mode: '100644' },
      { path: '.gm/scope/s_other.json', type: 'blob', mode: '100644' },
    ];
    expect(qaFolderRemovals('games/qa', tree, false)).toEqual([
      { path: 'games/qa/file.ts', type: 'blob', mode: '100644', sha: null },
      { path: 'games/qa/nested/link', type: 'blob', mode: '120000', sha: null },
    ]);
    expect(() => qaFolderRemovals('games/qa', tree, true)).toThrow(/truncated/);
    expect(() => qaFolderRemovals('games/../other', tree, false)).toThrow(/folder/);
    expect(qaFolderRemovals('games/qa', tree, false, ['.gm/scope/s_123.json'])).toContainEqual({
      path: '.gm/scope/s_123.json',
      type: 'blob',
      mode: '100644',
      sha: null,
    });
    expect(() => qaFolderRemovals('games/qa', tree, false, ['.gm/scope/../other'])).toThrow(/scope/);
  });

  it('confirms the removal PR merged and the folder is absent on main', async () => {
    const calls: string[] = [];
    let checks = 0;
    const git = {
      hasOpenCreationPull: async () => false,
      readMain: async () => ({
        sha: 'base',
        tree: [{ path: 'games/qa/a', type: 'blob', mode: '100644' }],
        truncated: false,
      }),
      openRemovalPull: async (_base: string, entries: unknown[]) => {
        calls.push(`open:${entries.length}`);
        return 7;
      },
      mergePull: async () => {
        calls.push('merge');
      },
      folderExists: async () => {
        checks++;
        return false;
      },
    };
    await expect(removeQaFolder('games/qa', git)).resolves.toEqual({ removed: true, pull: 7 });
    expect(calls).toEqual(['open:1', 'merge']);
    expect(checks).toBe(1);
    await expect(removeQaFolder('games/qa', git, true)).rejects.toThrow(/appeared/);
    expect(calls).toEqual(['open:1', 'merge']);
    await expect(removeQaFolder('games/qa', { ...git, hasOpenCreationPull: async () => true })).rejects.toThrow(
      /creation pull/,
    );
    await expect(removeQaFolder('games/qa', { ...git, folderExists: async () => true })).rejects.toThrow(
      /still exists/,
    );
  });

  it('resumes a verified open cleanup pull rather than creating a second one', async () => {
    const git = {
      hasOpenCreationPull: async () => false,
      recover: async () => ({ pull: 12, head: 'a'.repeat(40), merged: false }),
      readMain: async () => {
        throw new Error('must not create a second pull');
      },
      openRemovalPull: async () => {
        throw new Error('must not create a second pull');
      },
      mergePull: async () => undefined,
      folderExists: async () => false,
    };
    await expect(removeQaFolder('games/qa', git)).resolves.toEqual({ removed: true, pull: 12 });
  });
});
