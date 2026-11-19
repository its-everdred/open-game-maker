import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QaCreateFence } from '../src/qa-create-fence.js';

describe('QA create fence', () => {
  it('blocks new creates, drains existing creates and survives restart until its owner releases it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-fence-'));
    try {
      const fence = new QaCreateFence(dir);
      await mkdir(join(dir, 'commit'), { recursive: true });
      await writeFile(
        join(dir, 'commit', 'audit.jsonl'),
        `${JSON.stringify({ gameId: 'g_example', op: 'create_game', result: 'error' })}\n`,
      );
      expect(await fence.hasTerminalAudit('g_example')).toBe(true);
      expect(await fence.hasTerminalAudit('g_other')).toBe(false);
      const done = await fence.begin('g_example');
      expect(done).not.toBeNull();
      expect(await fence.acquire('g_example', 'run-1')).toBe(false);
      expect(await fence.begin('g_example')).toBeNull();
      await done!();
      expect(await fence.acquire('g_example', 'run-1')).toBe(true);
      const restarted = new QaCreateFence(dir);
      expect(await restarted.begin('g_example')).toBeNull();
      await expect(restarted.release('g_example', 'wrong-owner')).rejects.toThrow(/owner/);
      await restarted.release('g_example', 'run-1');
      const later = await restarted.begin('g_example');
      expect(later).not.toBeNull();
      await later!();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
