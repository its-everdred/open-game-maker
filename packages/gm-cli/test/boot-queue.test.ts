import { describe, expect, it, vi } from 'vitest';
import { gm, tempDir } from './helpers.js';

const state = vi.hoisted(() => ({ request: undefined as unknown, localServerCalled: false }));
vi.mock('@ogm/gm-verify', async (original) => ({
  ...(await original()),
  submitRequest: (_root: string, request: unknown) => {
    state.request = request;
    return tempDir();
  },
  waitForReport: async () => ({ verdict: 'fail', error: 'blank frame', frames: [] }),
  serveStatic: async () => {
    state.localServerCalled = true;
    throw new Error('sandbox tried to serve');
  },
}));

describe('queued boot check', () => {
  it('asks the host to check the selected build and propagates failure', async () => {
    const result = await gm(['check', 'boot', '--dist', 'build', '--viewport', 'phone'], {
      env: { GM_VERIFY_QUEUE: '1' },
    });
    expect(result.code).toBe(1);
    expect(result.err.join(' ')).toContain('blank frame');
    expect(state.request).toMatchObject({ serveDir: 'build', args: { boot: true, viewport: 'phone' } });
    expect(state.localServerCalled).toBe(false);
    await gm(['check', 'boot', '--dist', '.'], { env: { GM_VERIFY_QUEUE: '1' } });
    expect(state.request).toMatchObject({ serveDir: '.' });
  });
});
