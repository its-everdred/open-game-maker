import { describe, expect, it, vi } from 'vitest';

import { L1Watchdog } from '../src/gates/l1-watchdog.js';

describe('L1 watchdog', () => {
  it('reports progress and rejects a stalled page after 90 seconds without a tick', async () => {
    vi.useFakeTimers();
    const output = vi.fn();
    const watchdog = new L1Watchdog(100, 120_000, output);
    try {
      watchdog.startTicks();
      watchdog.progressed(12);
      const stalled = watchdog.wait(new Promise(() => {}));
      const failure = expect(stalled).rejects.toThrow('stalled at tick 12: no tick progress for 90 seconds');
      await vi.advanceTimersByTimeAsync(90_000);
      await failure;
      expect(output).toHaveBeenCalledWith('tick 12/100 (advancing ticks)');
      expect(watchdog.controller.signal.aborted).toBe(true);
    } finally {
      watchdog.close();
      vi.useRealTimers();
    }
  });

  it('enforces the overall deadline even before ticks start', async () => {
    vi.useFakeTimers();
    const watchdog = new L1Watchdog(60, 500);
    try {
      const result = watchdog.wait(new Promise(() => {}));
      const failure = expect(result).rejects.toThrow('deadline exceeded during starting');
      await vi.advanceTimersByTimeAsync(500);
      await failure;
    } finally {
      watchdog.close();
      vi.useRealTimers();
    }
  });
});
