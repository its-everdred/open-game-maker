import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { scanLegacyText } from '../src/text-scan.js';

it('shares a scan, caches unchanged results, and notices replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ogm-scan-'));
  try {
    const file = join(root, 'game.js');
    await writeFile(file, `fetch('/a/${'a'.repeat(64)}.png')`);
    const rewrite = vi.fn((text: string) => text);
    expect(
      await Promise.all([scanLegacyText(file, 'scope', [], rewrite), scanLegacyText(file, 'scope', [], rewrite)]),
    ).toEqual([{ status: 'unchanged' }, { status: 'unchanged' }]);
    expect(rewrite).toHaveBeenCalledTimes(1);
    await scanLegacyText(file, 'scope', [], rewrite);
    expect(rewrite).toHaveBeenCalledTimes(1);
    await writeFile(file, `fetch('/a/${'b'.repeat(64)}.png')`);
    await scanLegacyText(file, 'scope', [], rewrite);
    expect(rewrite).toHaveBeenCalledTimes(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
