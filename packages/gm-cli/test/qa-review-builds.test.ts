import { expect, it, vi } from 'vitest';
import { openTicketBuilds } from '../src/qa-review-checks.js';

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
