import { assetManifestSchema, cachePlanSchema, type AssetManifest, type Tier } from '@ogm/contracts/assets';
import {
  ImageBitmapLoader,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type Mesh,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

import {
  ASSET_CACHE_NAME,
  CACHE_LOCK_NAME,
  isPrivatePreviewUrl,
  matchCachedAsset,
  prepare as prepareCache,
  type LedgerBuild,
  type LoadSender,
  type PrepareResult,
} from './cache.js';
import { AssetNotFound, AssetUnavailable } from './errors.js';
import { createGltf, type GltfHandle } from '../three/gltf.js';

type AssetEntry = AssetManifest['assets'][string];

export interface ResolvedAsset {
  url: string;
  file: string;
  mesh?: string;
  bounds?: [number, number, number];
  meta?: AssetEntry['meta'];
  license: AssetEntry['license'];
}

export interface AssetLoaderOptions {
  manifestUrl: string;
  tier: Tier;
  fetch?: typeof globalThis.fetch;
  audioContext?: BaseAudioContext;
  basisPath?: string;
  planUrl?: string;
  send?: LoadSender;
  channel?: LedgerBuild['channel'];
  cacheStorage?: Pick<CacheStorage, 'open'>;
}

const TIER_CHAINS = {
  desktop: ['desktop', '*'],
  mobile: ['mobile', 'desktop', '*'],
  low: ['low', 'mobile', 'desktop', '*'],
} as const satisfies Record<Tier, readonly (Tier | '*')[]>;

function absoluteUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    if (!globalThis.location?.href) {
      throw new TypeError(`Asset manifest URL must be absolute outside a browser: ${url}`);
    }
    return new URL(url, globalThis.location.href).toString();
  }
}

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true;
}

function firstMesh(gltf: GLTF): Mesh | undefined {
  let found: Mesh | undefined;
  gltf.scene.traverse((object) => {
    if (!found && isMesh(object)) found = object;
  });
  return found;
}

function offlineAudioContext(): BaseAudioContext {
  if (typeof globalThis.OfflineAudioContext !== 'function') {
    throw new Error('audio() requires an audioContext when OfflineAudioContext is unavailable');
  }
  return new globalThis.OfflineAudioContext(1, 1, 44_100);
}

export class AssetLoader {
  readonly tier: Tier;
  readonly #manifestUrl: string;
  readonly #basisPath: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #audioContext: BaseAudioContext | undefined;
  readonly #planUrl: string;
  readonly #send: LoadSender | undefined;
  readonly #channel: LedgerBuild['channel'];
  readonly #cacheStorage: Pick<CacheStorage, 'open'> | undefined;
  readonly #files = new Map<string, Promise<ArrayBuffer>>();
  readonly #gltfs = new Map<string, Promise<GLTF>>();
  readonly #groups = new Map<string, Promise<void>>();
  readonly #groupProgress = new Map<
    string,
    { loaded: number; total?: number; listeners: Set<(progress: { loaded: number; total: number }) => void> }
  >();
  readonly #groupFiles = new Map<string, Set<string>>();
  readonly #groupTokens = new Map<string, symbol>();
  #manifest: AssetManifest | undefined;
  #manifestPromise: Promise<AssetManifest> | undefined;
  #renderer: WebGLRenderer | undefined;
  #gltfDecoder: GltfHandle | undefined;

  constructor(options: AssetLoaderOptions) {
    this.tier = options.tier;
    this.#manifestUrl = absoluteUrl(options.manifestUrl);
    this.#basisPath = new URL(options.basisPath ?? 'basis/', this.#manifestUrl).toString();
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#audioContext = options.audioContext;
    this.#planUrl = new URL(options.planUrl ?? 'cache-plan.json', this.#manifestUrl).toString();
    this.#send = options.send;
    this.#channel = options.channel ?? 'test';
    this.#cacheStorage = options.cacheStorage;
  }

  load(): Promise<AssetManifest> {
    this.#manifestPromise ??= this.#loadManifest();
    return this.#manifestPromise;
  }

  prepare(): Promise<PrepareResult | undefined> {
    if (!this.#send) throw new Error('prepare() requires a load message sender');
    return prepareCache(
      { plan: this.#planUrl, tier: this.tier, send: this.#send, channel: this.#channel },
      { fetcher: this.#fetch, cacheStorage: this.#cacheStorage },
    );
  }

  resolve(id: string): ResolvedAsset {
    const manifest = this.#loadedManifest();
    const entry = manifest.assets[id];
    if (!entry) throw new AssetNotFound(id);

    const tried = TIER_CHAINS[this.tier];
    const file = tried.map((tier) => entry.file[tier]).find((candidate) => candidate !== undefined);
    if (!file) throw new AssetUnavailable(id, tried);

    return {
      url: new URL(file, this.#manifestUrl).toString(),
      file,
      ...(entry.mesh ? { mesh: entry.mesh } : {}),
      ...(entry.bounds ? { bounds: entry.bounds } : {}),
      ...(entry.meta ? { meta: entry.meta } : {}),
      license: entry.license,
    };
  }

  async preload(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.#fetchFile(this.resolve(id).file)));
  }

  /** Load a lazy group. Progress is reported in completed files, including cached files. */
  loadGroup(name: string, onProgress?: (progress: { loaded: number; total: number }) => void): Promise<void> {
    const existing = this.#groups.get(name);
    if (existing) {
      const progress = this.#groupProgress.get(name)!;
      if (onProgress) {
        progress.listeners.add(onProgress);
        if (progress.total !== undefined) onProgress({ loaded: progress.loaded, total: progress.total });
      }
      return existing;
    }
    const progress = {
      loaded: 0,
      total: undefined as number | undefined,
      listeners: new Set<(value: { loaded: number; total: number }) => void>(),
    };
    if (onProgress) progress.listeners.add(onProgress);
    this.#groupProgress.set(name, progress);
    const token = Symbol(name);
    this.#groupTokens.set(name, token);
    const request = this.#loadGroup(name, token, (value) => {
      progress.loaded = value.loaded;
      progress.total = value.total;
      for (const listener of progress.listeners) listener(value);
    }).catch((error: unknown) => {
      if (this.#groups.get(name) === request) this.unloadGroup(name);
      throw error;
    });
    this.#groups.set(name, request);
    return request;
  }

  unloadGroup(name: string): void {
    this.#groups.delete(name);
    this.#groupProgress.delete(name);
    this.#groupTokens.delete(name);
    const files = this.#groupFiles.get(name);
    this.#groupFiles.delete(name);
    for (const file of files ?? []) {
      this.#releaseFile(file);
    }
  }

  #releaseFile(file: string): void {
    if ([...this.#groupFiles.values()].some((files) => files.has(file))) return;
    this.#files.delete(file);
    this.#gltfs.delete(file);
  }

  async #loadGroup(
    name: string,
    token: symbol,
    onProgress?: (progress: { loaded: number; total: number }) => void,
  ): Promise<void> {
    const manifest = await this.load();
    const ids = Object.entries(manifest.assets)
      .filter(([, asset]) => asset.phase === `lazy:${name}`)
      .map(([id]) => id);
    if (ids.length === 0) throw new Error(`Unknown asset group: ${name}`);
    const files = new Set(ids.map((id) => this.resolve(id).file));
    const response = await this.#fetch(this.#planUrl);
    if (response.ok && !response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
      const plan = cachePlanSchema.parse(await response.json());
      for (const entry of plan.entries) {
        if (
          entry.ids?.some((id) => ids.includes(id)) &&
          (entry.tiers.includes('*') || entry.tiers.includes(this.tier)) &&
          (entry.assetPhasesByTier?.[this.tier]?.includes(`lazy:${name}`) ?? true)
        )
          files.add(entry.url);
      }
    } else if (!response.ok && response.status !== 404)
      throw new Error(`Failed to load cache plan: HTTP ${response.status}`);
    if (this.#groupTokens.get(name) !== token) throw new Error(`Asset group load canceled: ${name}`);
    this.#groupFiles.set(name, files);
    let loaded = 0;
    onProgress?.({ loaded, total: files.size });
    try {
      const fetchFiles = async () => {
        const results = await Promise.allSettled(
          [...files].map(async (file) => {
            const bytes = await this.#fetchFile(file);
            const storage = isPrivatePreviewUrl(this.#manifestUrl)
              ? undefined
              : (this.#cacheStorage ?? globalThis.caches);
            if (storage) {
              try {
                const cache = await storage.open(ASSET_CACHE_NAME);
                await cache.put(new URL(file, this.#manifestUrl).toString(), new Response(bytes.slice(0)));
              } catch {
                // Loading remains usable when browser storage is unavailable or full.
              }
            }
            onProgress?.({ loaded: ++loaded, total: files.size });
          }),
        );
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      };
      const locks = isPrivatePreviewUrl(this.#manifestUrl) ? undefined : globalThis.navigator?.locks;
      if (locks) await locks.request(CACHE_LOCK_NAME, { mode: 'shared' }, fetchFiles);
      else await fetchFiles();
      if (this.#groupTokens.get(name) !== token) throw new Error(`Asset group load canceled: ${name}`);
    } finally {
      if (this.#groupTokens.get(name) !== token) for (const file of files) this.#releaseFile(file);
    }
  }

  async mesh(id: string): Promise<Mesh> {
    const resolved = this.resolve(id);
    const gltf = await this.#gltf(resolved.file);
    const named = resolved.mesh ? gltf.scene.getObjectByName(resolved.mesh) : undefined;
    const mesh = named && isMesh(named) ? named : firstMesh(gltf);
    if (!mesh) {
      const expected = resolved.mesh ? ` named ${resolved.mesh}` : '';
      throw new Error(`Asset ${id} contains no mesh${expected}`);
    }
    return mesh;
  }

  async texture(id: string): Promise<Texture> {
    const resolved = this.resolve(id);
    const bytes = await this.#fetchFile(resolved.file);
    if (typeof URL.createObjectURL !== 'function') {
      throw new Error(`Asset ${id} cannot be decoded because object URLs are unavailable`);
    }

    const objectUrl = URL.createObjectURL(new Blob([bytes]));
    try {
      let texture: Texture;
      if (typeof globalThis.createImageBitmap === 'function') {
        const image = await new ImageBitmapLoader().loadAsync(objectUrl);
        texture = new Texture(image);
      } else {
        texture = await new TextureLoader().loadAsync(objectUrl);
      }
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async audio(id: string): Promise<AudioBuffer> {
    const resolved = this.resolve(id);
    const bytes = await this.#fetchFile(resolved.file);
    const context = this.#audioContext ?? offlineAudioContext();
    return context.decodeAudioData(bytes.slice(0));
  }

  attachRenderer(renderer: WebGLRenderer): void {
    this.#renderer = renderer;
    this.#gltfDecoder = createGltf(renderer, { basisPath: this.#basisPath });
  }

  async #loadManifest(): Promise<AssetManifest> {
    try {
      const response = await this.#fetch(this.#manifestUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = assetManifestSchema.parse(await response.json());
      this.#manifest = parsed;
      return parsed;
    } catch (cause) {
      throw new Error(`Failed to load asset manifest ${this.#manifestUrl}`, { cause });
    }
  }

  #loadedManifest(): AssetManifest {
    if (!this.#manifest) throw new Error(`Asset manifest is not loaded: call load() first`);
    return this.#manifest;
  }

  #fetchFile(file: string): Promise<ArrayBuffer> {
    const existing = this.#files.get(file);
    if (existing) return existing;

    const url = new URL(file, this.#manifestUrl).toString();
    const cached = isPrivatePreviewUrl(url) ? Promise.resolve(undefined) : matchCachedAsset(url, this.#cacheStorage);
    const request = cached
      .then(async (cached) => {
        const response = cached ?? (await this.#fetch(url));
        if (!response.ok) throw new Error(`Failed to fetch asset file ${url}: HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .catch((error: unknown) => {
        if (this.#files.get(file) === request) this.#files.delete(file);
        throw error;
      });
    this.#files.set(file, request);
    return request;
  }

  #gltf(file: string): Promise<GLTF> {
    const existing = this.#gltfs.get(file);
    if (existing) return existing;

    const request = this.#parseGltf(file).catch((error: unknown) => {
      this.#gltfs.delete(file);
      throw error;
    });
    this.#gltfs.set(file, request);
    return request;
  }

  async #parseGltf(file: string): Promise<GLTF> {
    const metadata = this.#loadedManifest().files[file];
    if (!metadata) throw new Error(`Asset file is missing from the manifest: ${file}`);

    if (metadata.decoders.includes('ktx2') && !this.#renderer) {
      throw new Error(`Asset file ${file} uses KTX2; call attachRenderer() before decoding it`);
    }

    const bytes = await this.#fetchFile(file);
    this.#gltfDecoder ??= createGltf(this.#renderer, { basisPath: this.#basisPath });
    return this.#gltfDecoder.decode(bytes, file, new URL('.', new URL(file, this.#manifestUrl)).toString());
  }
}

export function createAssetLoader(options: AssetLoaderOptions): AssetLoader {
  return new AssetLoader(options);
}
