import { errors, type Page } from 'playwright';

export class ScreenshotTimeout extends Error {}

export async function captureStill(
  page: Page,
  path: string | undefined,
  stage: string,
  timeout: number,
): Promise<void> {
  try {
    await page.screenshot({ ...(path ? { path } : {}), timeout, caret: 'initial' });
  } catch (error) {
    if (error instanceof errors.TimeoutError)
      throw new ScreenshotTimeout(`shell capture: ${stage} screenshot timed out after ${timeout / 1000} seconds`);
    throw error;
  }
}
