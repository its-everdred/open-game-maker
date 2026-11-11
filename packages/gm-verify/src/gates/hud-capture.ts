import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Page } from 'playwright';

/** Capture the whole page, including DOM HUD elements, with a bounded failure diagnostic. */
export async function captureHud(page: Page, path: string): Promise<Buffer> {
  try {
    return await page.screenshot({ path, type: 'png', timeout: 15_000 });
  } catch (error) {
    const diagnosticPath = join(dirname(path), 'hud-dom.html');
    let diagnostic = 'DOM snapshot unavailable';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const dom = await Promise.race([
        page.content(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('DOM snapshot timed out')), 1_000);
        }),
      ]);
      await writeFile(diagnosticPath, dom);
      diagnostic = `DOM snapshot: ${diagnosticPath}`;
    } catch {
      // A stalled or closed page must not delay the gate indefinitely.
    } finally {
      if (timer) clearTimeout(timer);
    }
    throw new Error(`whole-page screenshot (selector: none) failed; ${diagnostic}: ${String(error)}`, { cause: error });
  }
}
