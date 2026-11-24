import { beforeEach, describe, expect, it, vi } from 'vitest';

const initRuntime = vi.fn();
vi.mock('effekseer-runtime', () => ({ default: { initRuntime } }));

describe('loadEffekseer', () => {
  beforeEach(() => {
    vi.resetModules();
    initRuntime.mockReset();
  });

  it('fetches the wasm once per page, however many scenes start effects', async () => {
    initRuntime.mockImplementation((_path: string, onload: () => void) => onload());
    const { loadEffekseer } = await import('./runtime.js');
    const [a, b] = await Promise.all([loadEffekseer('/a.wasm'), loadEffekseer('/a.wasm')]);
    expect(a).toBe(b);
    await loadEffekseer('/a.wasm');
    expect(initRuntime).toHaveBeenCalledTimes(1);
    expect(initRuntime.mock.calls[0]![0]).toBe('/a.wasm');
  });

  it('lets a later scene retry after the wasm failed to load', async () => {
    initRuntime.mockImplementationOnce((_path: string, _onload: () => void, onerror: () => void) => onerror());
    initRuntime.mockImplementationOnce((_path: string, onload: () => void) => onload());
    const { loadEffekseer } = await import('./runtime.js');
    await expect(loadEffekseer('/missing.wasm')).rejects.toThrow('/missing.wasm');
    await expect(loadEffekseer('/a.wasm')).resolves.toBeDefined();
    expect(initRuntime).toHaveBeenCalledTimes(2);
  });
});
