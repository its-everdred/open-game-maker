import { expect, it, vi } from 'vitest';
import {
  QA_SCREENSHOT_TIMEOUT_MS,
  SLOW_HOST_ACTION_TIMEOUT_MS,
  captureQaStill,
  openRunningTicket,
  openTicketBuilds,
} from '../src/qa-review-checks.js';

it('opens Builds when signed-in review data mounts it after a slow load', async () => {
  vi.useFakeTimers();
  try {
    let mounted = false;
    const button = {
      waitFor: async ({ timeout }: { timeout: number }) => {
        await new Promise((resolve) => setTimeout(resolve, Math.min(timeout, 30_000)));
        if (timeout < 30_000) throw new Error('not mounted');
        mounted = true;
      },
      click: async () => {
        if (!mounted) throw new Error('not mounted');
      },
    };
    const panel = { waitFor: async () => {} };
    const page = { locator: () => button, getByRole: () => panel } as unknown as Parameters<typeof openTicketBuilds>[0];
    const result = openTicketBuilds(page).then(
      () => 'opened',
      () => 'failed',
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toBe('opened');
  } finally {
    vi.useRealTimers();
  }
});

it('allows a running ticket click to wait for a slow host navigation', async () => {
  const timeouts: number[] = [];
  const details = { click: async ({ timeout }: { timeout: number }) => timeouts.push(timeout) };
  const row = {
    click: async ({ timeout }: { timeout: number }) => timeouts.push(timeout),
    locator: () => ({ getByRole: () => details }),
  };
  const panel = { getByRole: () => row };
  const page = { getByRole: () => panel } as unknown as Parameters<typeof openRunningTicket>[0];

  await openRunningTicket(page, 'QA running ticket');

  expect(timeouts).toEqual([SLOW_HOST_ACTION_TIMEOUT_MS, SLOW_HOST_ACTION_TIMEOUT_MS]);
  expect(SLOW_HOST_ACTION_TIMEOUT_MS).toBeGreaterThan(20_000);
});

it('gives QA evidence screenshots time to finish on a loaded host', async () => {
  let options: { path: string; timeout: number } | undefined;
  const page = {
    screenshot: async (given: { path: string; timeout: number }) => {
      options = given;
    },
  } as unknown as Parameters<typeof captureQaStill>[0];

  await captureQaStill(page, '/tmp/still.png');

  expect(options).toEqual({ path: '/tmp/still.png', timeout: QA_SCREENSHOT_TIMEOUT_MS });
  expect(QA_SCREENSHOT_TIMEOUT_MS).toBeGreaterThan(30_000);
});
