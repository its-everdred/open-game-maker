import { ASSETS_SCHEMA_MINOR, type AssetManifest, type AssetMetadata } from '@ogm/contracts';
import type { WebGLRenderer } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetNotFound, AssetUnavailable } from './errors.js';
import { AssetLoader } from './loader.js';

const gltfSpies = vi.hoisted(() => ({
  constructed: vi.fn(),
  meshopt: vi.fn(),
  ktx2: vi.fn(),
  parse: vi.fn(),
}));

const ktx2Spies = vi.hoisted(() => ({
  constructed: vi.fn(),
  transcoderPath: vi.fn(),
  detectSupport: vi.fn(),
}));

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    constructor() {
      gltfSpies.constructed();
    }

    setMeshoptDecoder(decoder: unknown) {
      gltfSpies.meshopt(decoder);
      return this;
    }

    setKTX2Loader(loader: unknown) {
      gltfSpies.ktx2(loader);
      return this;
    }

    parseAsync(data: ArrayBuffer, path: string) {
      return gltfSpies.parse(data, path);
    }
  },
}));

vi.mock('three/addons/loaders/KTX2Loader.js', () => ({
  KTX2Loader: class {
    constructor() {
      ktx2Spies.constructed();
    }

    setTranscoderPath(path: string) {
      ktx2Spies.transcoderPath(path);
      return this;
    }

    detectSupport(renderer: unknown) {
      ktx2Spies.detectSupport(renderer);
      return this;
    }
  },
}));

const fileBytes = new Uint8Array([1, 2, 3, 4]).buffer;
const mesh = { isMesh: true, name: 'castle/tower-base' };
const metadata = {
  kit: { piece: 'wall', grid_m: 1 },
  geometry: {
    bounds_m: { min: [0, 0, 0], max: [1, 1, 1] },
    triangles: 12,
    normalized: true,
  },
} satisfies AssetMetadata;

const manifest: AssetManifest = {
  version: 1,
  tiers: ['desktop', 'mobile', 'low'],
  files: {
    'kit-castle.3f9a1c.glb': { bytes: 4, tris: 38_000, gpuTexMB: 1.4, decoders: ['meshopt'] },
    'monster-yeti.desktop.c02d.glb': { bytes: 4, decoders: ['meshopt'] },
    'monster-yeti.mobile.a81e.glb': { bytes: 4, decoders: ['meshopt'] },
    'texture.ktx2.glb': { bytes: 4, decoders: ['ktx2'] },
    'texture-second.ktx2.glb': { bytes: 4, decoders: ['ktx2'] },
    'sound.ogg': { bytes: 4, decoders: [] },
  },
  assets: {
    'castle/tower-base': {
      file: { '*': 'kit-castle.3f9a1c.glb' },
      mesh: 'castle/tower-base',
      bounds: [1, 1.31, 1],
      meta: metadata,
      license: { id: 'CC0-1.0', attribution: 'Kenney', use: 'any' },
    },
    'castle/tower-alt': {
      file: { '*': 'kit-castle.3f9a1c.glb' },
      license: { id: 'CC0-1.0', use: 'any' },
    },
    'monsters/yeti': {
      file: {
        desktop: 'monster-yeti.desktop.c02d.glb',
        mobile: 'monster-yeti.mobile.a81e.glb',
        low: 'monster-yeti.mobile.a81e.glb',
      },
      license: { id: 'CC0-1.0', use: 'any' },
    },
    'effects/ktx2': {
      file: { '*': 'texture.ktx2.glb' },
      license: { id: 'CC0-1.0', use: 'any' },
    },
    'effects/ktx2-second': {
      file: { '*': 'texture-second.ktx2.glb' },
      license: { id: 'CC0-1.0', use: 'any' },
    },
    'audio/theme': {
      file: { '*': 'sound.ogg' },
      license: { id: 'CC0-1.0', use: 'any' },
    },
  },
};

function response(options: { json?: unknown; bytes?: ArrayBuffer; ok?: boolean } = {}) {
  return {
    ok: options.ok ?? true,
    status: options.ok === false ? 500 : 200,
    json: vi.fn(async () => options.json),
    arrayBuffer: vi.fn(async () => options.bytes ?? fileBytes),
  } as unknown as Response;
}

function fetchFor(value: unknown = manifest) {
  return vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('manifest.json') ? response({ json: value }) : response({ bytes: fileBytes }),
  );
}

describe('AssetLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gltfSpies.parse.mockResolvedValue({
      scene: {
        getObjectByName: vi.fn((name: string) => (name === mesh.name ? mesh : undefined)),
        traverse: vi.fn((callback: (object: unknown) => void) => callback(mesh)),
      },
    });
  });

  it('resolves tier fallbacks and wildcard files without deriving a name', async () => {
    const loader = new AssetLoader({
      manifestUrl: 'https://game.test/assets/manifest.json',
      tier: 'low',
      fetch: fetchFor(),
    });
    await loader.load();

    expect(loader.resolve('monsters/yeti')).toMatchObject({
      file: 'monster-yeti.mobile.a81e.glb',
      url: 'https://game.test/assets/monster-yeti.mobile.a81e.glb',
    });
    expect(loader.resolve('castle/tower-base').file).toBe('kit-castle.3f9a1c.glb');
    expect(loader.resolve('castle/tower-base').meta).toEqual(metadata);
  });

  it('resolves older schema-minor-2 content addresses from the games origin root', async () => {
    const digest = 'a'.repeat(64);
    const file = `/a/${digest}.glb`;
    const contentAddressed = structuredClone(manifest);
    contentAddressed.minor = 2;
    contentAddressed.files[file] = { bytes: 4, decoders: ['meshopt'] };
    contentAddressed.assets['content-addressed/model'] = {
      file: { '*': file },
      license: { id: 'CC0-1.0', use: 'any' },
    };
    const loader = new AssetLoader({
      manifestUrl: 'https://game.test/g/game/build/assets/manifest.json',
      tier: 'desktop',
      fetch: fetchFor(contentAddressed),
    });
    await loader.load();

    expect(ASSETS_SCHEMA_MINOR).toBe(4);
    expect(loader.resolve('content-addressed/model')).toMatchObject({
      file,
      url: `https://game.test/a/${digest}.glb`,
    });
  });

  it('fetches a shared file once when ids preload in parallel', async () => {
    const fetch = fetchFor();
    const loader = new AssetLoader({
      manifestUrl: 'https://game.test/assets/manifest.json',
      tier: 'mobile',
      fetch,
    });
    await loader.load();

    await loader.preload(['castle/tower-base', 'castle/tower-alt']);

    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('kit-castle.3f9a1c.glb'))).toHaveLength(1);
  });

  it('reads content-addressed files from gm-blobs-v1 before the network', async () => {
    const digest = 'a'.repeat(64);
    const file = `/a/${digest}.glb`;
    const contentAddressed = structuredClone(manifest);
    contentAddressed.files[file] = { bytes: 4, decoders: ['meshopt'] };
    contentAddressed.assets['content-addressed/model'] = {
      file: { '*': file },
      license: { id: 'CC0-1.0', use: 'any' },
    };
    const fetch = fetchFor(contentAddressed);
    const match = vi.fn(async () => response({ bytes: fileBytes }));
    const cacheStorage = {
      open: vi.fn(async () => ({ match }) as unknown as Cache),
    };
    const loader = new AssetLoader({
      manifestUrl: 'https://game.test/g/game/build/assets/manifest.json',
      tier: 'desktop',
      fetch,
      cacheStorage,
    });
    await loader.load();

    await loader.preload(['content-addressed/model']);

    expect(cacheStorage.open).toHaveBeenCalledWith('gm-blobs-v1');
    expect(match).toHaveBeenCalledWith(`https://game.test/a/${digest}.glb`);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws named errors for unknown and unavailable assets', async () => {
    const unavailable = structuredClone(manifest);
    unavailable.assets['castle/tower-alt']!.file = {};
    const loader = new AssetLoader({
      manifestUrl: 'https://game.test/assets/manifest.json',
      tier: 'low',
      fetch: fetchFor(unavailable),
    });
    await loader.load();

    expect(() => loader.resolve('nope')).toThrow(AssetNotFound);
    expect(() => loader.resolve('nope')).toThrow('nope');
    expect(() => loader.resolve('castle/tower-alt')).toThrow(AssetUnavailable);
    expect(() => loader.resolve('castle/tower-alt')).toThrow('low → mobile → desktop → *');
  });

  it('configures meshopt without importing KTX2 for an ordinary GLB', async () => {
    const loader = new AssetLoader({
      manifestUrl: 'https://game.test/assets/manifest.json',
      tier: 'desktop',
      fetch: fetchFor(),
    });
    await loader.load();

    await expect(loader.mesh('castle/tower-base')).resolves.toBe(mesh);

    expect(gltfSpies.meshopt).toHaveBeenCalledOnce();
    expect(ktx2Spies.constructed).not.toHaveBeenCalled();
  });

  it('imports and configures KTX2 only for a file that declares it', async () => {
    const renderer = {} as WebGLRenderer;
    const loader = new AssetLoader({
      manifestUrl: 'https://game.test/assets/manifest.json',
      tier: 'desktop',
      fetch: fetchFor(),
    });
    await loader.load();
    loader.attachRenderer(renderer);

    await loader.mesh('effects/ktx2');
    await loader.mesh('effects/ktx2-second');

    expect(ktx2Spies.constructed).toHaveBeenCalledOnce();
    expect(ktx2Spies.transcoderPath).toHaveBeenCalledWith('https://game.test/assets/basis/');
    expect(ktx2Spies.detectSupport).toHaveBeenCalledWith(renderer);
    expect(gltfSpies.constructed).toHaveBeenCalledOnce();
    expect(gltfSpies.ktx2).toHaveBeenCalledOnce();
    expect(gltfSpies.parse).toHaveBeenCalledTimes(2);
  });

  it('requires an attached renderer before decoding KTX2', async () => {
    const renderer = {} as WebGLRenderer;
    const loader = new AssetLoader({
      manifestUrl: 'https://game.test/assets/manifest.json',
      tier: 'desktop',
      fetch: fetchFor(),
    });
    await loader.load();

    await expect(loader.mesh('effects/ktx2')).rejects.toThrow('attachRenderer');
    loader.attachRenderer(renderer);
    await expect(loader.mesh('effects/ktx2')).resolves.toBe(mesh);
  });

  it('names the manifest URL when fetch or schema validation fails', async () => {
    const fetchFailure = vi.fn(async () => response({ ok: false }));
    const fetchLoader = new AssetLoader({
      manifestUrl: 'https://game.test/assets/manifest.json',
      tier: 'desktop',
      fetch: fetchFailure,
    });
    const invalidLoader = new AssetLoader({
      manifestUrl: 'https://game.test/assets/invalid.json',
      tier: 'desktop',
      fetch: fetchFor({ version: 1, files: {} }),
    });

    await expect(fetchLoader.load()).rejects.toThrow('https://game.test/assets/manifest.json');
    await expect(invalidLoader.load()).rejects.toThrow('https://game.test/assets/invalid.json');
  });

  it('decodes audio bytes with the supplied context', async () => {
    const audioBuffer = {} as AudioBuffer;
    const audioContext = { decodeAudioData: vi.fn(async () => audioBuffer) } as unknown as BaseAudioContext;
    const loader = new AssetLoader({
      manifestUrl: 'https://game.test/assets/manifest.json',
      tier: 'desktop',
      fetch: fetchFor(),
      audioContext,
    });
    await loader.load();

    await expect(loader.audio('audio/theme')).resolves.toBe(audioBuffer);
    expect(audioContext.decodeAudioData).toHaveBeenCalledOnce();
    expect(audioContext.decodeAudioData).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  });
});
