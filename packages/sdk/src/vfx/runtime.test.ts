import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initRuntime = vi.fn();
vi.mock('effekseer-runtime', () => ({ default: { initRuntime } }));

/** The smallest valid module: `\0asm` and version 1. */
const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer;

function serve(status: number, body: ArrayBuffer = WASM) {
  return vi.fn(async () => new Response(body, { status }));
}

describe('loadEffekseer', () => {
  beforeEach(() => {
    vi.resetModules();
    initRuntime.mockReset();
    initRuntime.mockImplementation((_path: string, onload: () => void) => onload());
    URL.createObjectURL ??= () => 'blob:wasm';
    URL.revokeObjectURL ??= () => undefined;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the wasm once per page, however many scenes start effects', async () => {
    const fetch = serve(200);
    vi.stubGlobal('fetch', fetch);
    const { loadEffekseer } = await import('./runtime.js');
    const [a, b] = await Promise.all([loadEffekseer('/a.wasm'), loadEffekseer('/a.wasm')]);
    expect(a).toBe(b);
    await loadEffekseer('/a.wasm');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(initRuntime).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing wasm instead of hanging, and a later scene retries', async () => {
    // The runtime's own loader hands a 404 page to the wasm compiler and never settles.
    vi.stubGlobal('fetch', serve(404, new TextEncoder().encode('not found').buffer));
    const { loadEffekseer } = await import('./runtime.js');
    await expect(loadEffekseer('/missing.wasm')).rejects.toThrow('404 /missing.wasm');
    expect(initRuntime).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', serve(200));
    await expect(loadEffekseer('/a.wasm')).resolves.toBeDefined();
  });

  it('rejects a response that is not WebAssembly', async () => {
    vi.stubGlobal('fetch', serve(200, new TextEncoder().encode('<!doctype html>').buffer));
    const { loadEffekseer } = await import('./runtime.js');
    await expect(loadEffekseer('/spa-fallback.wasm')).rejects.toThrow('not valid WebAssembly');
    expect(initRuntime).not.toHaveBeenCalled();
  });
});
