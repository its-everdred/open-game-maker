import { describe, expect, it } from 'vitest';

import { runPromiseProcess } from '../src/gates/promise-process.js';

describe('promise spec process', () => {
  it('terminates a process that ignores SIGTERM when its timeout expires', async () => {
    const started = Date.now();
    const result = await runPromiseProcess(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 300,
      },
    );
    expect(result.error?.message).toContain('timed out or cancelled');
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
