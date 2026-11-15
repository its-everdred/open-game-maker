import { describe, expect, it } from 'vitest';

import { workerProgress } from '../../src/worker-progress/progress.js';

describe('worker progress', () => {
  it('reports the daemon check-in without extrapolating an ETA', () => {
    expect(workerProgress({ percent: 40, runtimeSeconds: 60, workpad: '- [x] Done\n- [ ] Later' })).toEqual({
      percent: 40,
      etaSeconds: null,
      source: 'daemon',
    });
    expect(workerProgress({ percent: 100, runtimeSeconds: 60 }).etaSeconds).toBeNull();
  });

  it('does not turn a workpad checklist into progress', () => {
    expect(workerProgress({ runtimeSeconds: 60, workpad: '- [x] First\n- [ ] Second' })).toEqual({
      percent: null,
      etaSeconds: null,
      source: 'unknown',
    });
  });
});

it('keeps demo and fixture data out of the production worker projection', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../src/worker-progress/list.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/(?:from\s*|import\s*\()[^\n]*["'][^"']*(?:fixture|demo)/i);
  expect(workerProgress({ percent: 50, runtimeSeconds: 30 }).etaSeconds).toBeNull();
});
