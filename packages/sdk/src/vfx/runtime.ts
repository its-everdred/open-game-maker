import type { EffekseerRuntime } from 'effekseer-runtime';

let pending: Promise<EffekseerRuntime> | undefined;

async function load(wasmUrl: string): Promise<EffekseerRuntime> {
  // The runtime's own loader ignores HTTP status and never settles on a bad binary, so the SDK fetches and checks it.
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Effekseer wasm failed to load: ${response.status} ${wasmUrl}`);
  const bytes = await response.arrayBuffer();
  if (!WebAssembly.validate(bytes)) throw new Error(`Effekseer wasm is not valid WebAssembly: ${wasmUrl}`);
  const { default: runtime } = await import('effekseer-runtime');
  const verified = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
  try {
    await new Promise<void>((resolve, reject) =>
      runtime.initRuntime(verified, resolve, () => reject(new Error(`Effekseer wasm failed to start: ${wasmUrl}`))),
    );
  } finally {
    URL.revokeObjectURL(verified);
  }
  return runtime;
}

/**
 * Loads Effekseer once per page: the script chunk is imported and the wasm fetched only when a scene first creates
 * effects, so games and scenes without effects never pay for them (about 410 KB gzipped). A failed load is forgotten,
 * so a later scene retries.
 */
export function loadEffekseer(wasmUrl: string): Promise<EffekseerRuntime> {
  if (!pending) {
    const attempt = load(wasmUrl);
    pending = attempt;
    attempt.catch(() => {
      if (pending === attempt) pending = undefined;
    });
  }
  return pending;
}
