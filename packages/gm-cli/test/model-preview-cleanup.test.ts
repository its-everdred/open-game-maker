import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('../src/packs/preview-process-tree.js', () => ({
  previewDescendants: () => [],
  killPreviewDescendants: () => {
    throw new Error('cleanup refused');
  },
}));

import { runPreviewWorker } from '../src/packs/model-preview.js';

it('kills the worker even if descendant cleanup fails', async () => {
  const script = join(await mkdtemp(join(tmpdir(), 'gm-preview-cleanup-')), 'worker.cjs');
  await writeFile(script, "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n");
  await expect(runPreviewWorker(script, [], 3_000)).rejects.toThrow('cleanup failed: Error: cleanup refused');
}, 20_000);
