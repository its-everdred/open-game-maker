import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page } from 'playwright';
import { expect, it, vi } from 'vitest';

import { captureHud } from '../src/gates/hud-capture.js';

it('bounds a failed capture and saves the DOM with the selector in the diagnostic', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-hud-'));
  const screenshot = vi.fn().mockRejectedValue(new Error('capture stalled'));
  const page = { screenshot, content: async () => '<html><body>HUD</body></html>' } as unknown as Page;
  await expect(captureHud(page, join(dir, 'hud.png'))).rejects.toThrow(
    /selector: none.*hud-dom\.html.*capture stalled/,
  );
  expect(screenshot).toHaveBeenCalledWith(expect.objectContaining({ timeout: 15_000 }));
  expect(readFileSync(join(dir, 'hud-dom.html'), 'utf8')).toContain('HUD');
});
