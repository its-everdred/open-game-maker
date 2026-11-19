import { errors, type Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { captureStill, ScreenshotTimeout } from '../app-capture/still';

describe('shell still capture', () => {
  it('reports the stage when the screenshot times out', async () => {
    const screenshot = vi.fn().mockRejectedValue(new errors.TimeoutError('stalled'));
    await expect(captureStill({ screenshot } as unknown as Page, 'out.png', 'play at 390x844', 10_000)).rejects.toThrow(
      new ScreenshotTimeout('shell capture: play at 390x844 screenshot timed out after 10 seconds'),
    );
    expect(screenshot).toHaveBeenCalledWith({ path: 'out.png', timeout: 10_000, caret: 'initial' });
  });

  it('probes a frame without writing a file', async () => {
    const screenshot = vi.fn().mockResolvedValue(Buffer.from('frame'));
    await captureStill({ screenshot } as unknown as Page, undefined, 'first frame', 5_000);
    expect(screenshot).toHaveBeenCalledWith({ timeout: 5_000, caret: 'initial' });
  });

  it('does not treat other screenshot errors as timeouts', async () => {
    const error = new Error('page closed');
    const screenshot = vi.fn().mockRejectedValue(error);
    await expect(captureStill({ screenshot } as unknown as Page, 'out.png', 'menu', 30_000)).rejects.toBe(error);
  });
});
