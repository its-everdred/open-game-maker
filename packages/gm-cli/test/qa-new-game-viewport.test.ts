import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { newGameViewport } from '../src/qa-new-game-viewport.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('New Game viewport cleanup', () => {
  it('cleans a known game after failed creation and reports cleanup failures', async () => {
    const page = { video: () => ({ path: async () => '/tmp/example.webm' }) };
    const context = { addCookies: vi.fn(), newPage: async () => page, close: vi.fn() };
    const browser = { newContext: async () => context } as never;
    const cleanup = vi.fn(async () => {
      throw new Error('failure details should not leak');
    });
    const out = mkdtempSync(join(tmpdir(), 'qa-'));
    dirs.push(out);
    const result = await newGameViewport(
      browser,
      {
        origin: 'https://example.test',
        cookie: { name: 'test', value: 'test' },
        out,
        viewport: { width: 390, height: 844 },
        verify: vi.fn(),
        cleanup,
      },
      {
        steps: async (_page, _origin, _still, created) => {
          await created({ id: 'g_test', status: 502, ok: false });
          throw new Error('game creation returned 502');
        },
        encode: vi.fn(async () => undefined),
      },
    );
    expect(cleanup).toHaveBeenCalledWith({ id: 'g_test', status: 502, ok: false });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('QA cleanup failed; inspect the run before retrying');
    expect(result.failures.join(' ')).not.toContain('failure details');
    expect(context.close).toHaveBeenCalledOnce();
  });
});
