import { AssetLoader } from '@gm/sdk/assets';
import { vi } from 'vitest';

export const BASE = 'https://game.test/assets/';

export interface FixtureAsset {
  file?: string;
  mesh?: string;
  meta?: Record<string, unknown>;
}

/** A loaded `AssetLoader` over an in-memory manifest; `fetch` serves `files` and counts each request. */
export async function fixtureLoader(assets: Record<string, FixtureAsset>, files: Record<string, ArrayBuffer> = {}) {
  const listed = new Set([
    ...Object.keys(files),
    ...Object.entries(assets).map(([id, asset]) => asset.file ?? `${id}.glb`),
  ]);
  const manifest = {
    version: 1,
    tiers: ['desktop'],
    files: Object.fromEntries([...listed].map((file) => [file, { bytes: files[file]?.byteLength ?? 0, decoders: [] }])),
    assets: Object.fromEntries(
      Object.entries(assets).map(([id, asset]) => [
        id,
        {
          file: { '*': asset.file ?? `${id}.glb` },
          ...(asset.mesh ? { mesh: asset.mesh } : {}),
          ...(asset.meta ? { meta: asset.meta } : {}),
          license: { id: 'CC0-1.0', use: 'any' },
        },
      ]),
    ),
  };
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === `${BASE}manifest.json`) return Response.json(manifest);
    const bytes = files[url.slice(BASE.length)];
    return bytes ? new Response(bytes) : new Response('missing', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  const loader = new AssetLoader({ manifestUrl: `${BASE}manifest.json`, tier: 'desktop', fetch });
  await loader.load();
  return { loader, fetch };
}
