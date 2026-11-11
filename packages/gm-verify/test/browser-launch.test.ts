import { chromium } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';

import { launch } from '../src/browser.js';

afterEach(() => vi.restoreAllMocks());

it('uses software compositing only for the L1 software browser', async () => {
  const start = vi.spyOn(chromium, 'launch').mockResolvedValue({} as never);
  await launch(true, true);
  await launch(true);
  await launch(false, true);
  expect(start.mock.calls[0]?.[0]?.args).toContain('--disable-gpu-compositing');
  expect(start.mock.calls[1]?.[0]?.args).not.toContain('--disable-gpu-compositing');
  expect(start.mock.calls[2]?.[0]?.args).not.toContain('--disable-gpu-compositing');
});
