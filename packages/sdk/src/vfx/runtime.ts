import type { EffekseerRuntime } from 'effekseer-runtime';

let pending: Promise<EffekseerRuntime> | undefined;

/**
 * Loads Effekseer once per page: the script chunk is imported and the wasm fetched only when a scene first creates
 * effects, so games and scenes without effects never pay for them (about 410 KB gzipped).
 */
export function loadEffekseer(wasmUrl: string): Promise<EffekseerRuntime> {
  pending ??= import('effekseer-runtime').then(
    ({ default: runtime }) =>
      new Promise<EffekseerRuntime>((resolve, reject) =>
        runtime.initRuntime(
          wasmUrl,
          () => resolve(runtime),
          () => reject(new Error(`Effekseer wasm failed to load: ${wasmUrl}`)),
        ),
      ),
  );
  pending.catch(() => {
    pending = undefined;
  });
  return pending;
}
