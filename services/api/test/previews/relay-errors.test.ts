import { afterEach, expect, it, vi } from 'vitest';

import type { AppDeps } from '../../src/app/types.js';
import { startPreviewRelay } from '../../src/previews/relay.js';

afterEach(() => vi.useRealTimers());

it('logs the relay scan error message', async () => {
  vi.useFakeTimers();
  const log = vi.fn();
  const deps = {
    db: {
      select: () => {
        throw new TypeError('scan detail');
      },
    },
    log,
  } as unknown as AppDeps;
  startPreviewRelay(deps, async () => false);
  await vi.waitFor(() =>
    expect(log).toHaveBeenCalledWith({ event: 'preview_relay_scan_failed', reason: 'scan detail' }),
  );
});
