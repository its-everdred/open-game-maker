export type ResourceSample = {
  url: string;
  status: number | null;
  transferSize: number;
  duration: number;
  cacheControl: string | null;
  cache: 'cache (memory/disk unknown)' | 'network' | 'unknown';
};

export type GamesCacheReport = {
  game: string;
  viewport: { width: 390; height: 844 };
  logo: ResourceSample | null;
  thumbnail: ResourceSample | null;
  gamesListApi: { url: string; status: number | null; duration: number } | null;
  ok: boolean;
};

export type CacheRun = {
  game: string;
  logoUrl?: string;
  thumbnailUrl?: string;
  resources: ResourceSample[];
  firstResources?: ResourceSample[];
  api: GamesCacheReport['gamesListApi'];
};

export type BuildCacheEntry = { sourcePath: string; url: string; bytes: number };
export type BuildCacheSample = { url: string; transferSize: number };
export type AfterPublishReport = {
  game: string;
  buildId: string;
  previousBuildId: string;
  totalBytesTransferred: number;
  changedFiles: Array<{ path: string; from: string | null; to: string | null; bytes: number }>;
  unexpectedChanges: Array<{ path: string; from: string | null; to: string | null; bytes: number }>;
  unexpectedTransfers: Array<{ path: string; url: string; bytes: number }>;
  ok: boolean;
};

export function matchesConfiguredOrigin(requested: string, configured: string | undefined): boolean {
  if (!configured) return false;
  try {
    return new URL(requested).origin === new URL(configured).origin;
  } catch {
    return false;
  }
}

export function selectGameImageUrls(images: readonly { className: string; src: string; currentSrc: string }[]) {
  const url = (className: string) => {
    const image = images.find((candidate) => candidate.className.split(/\s+/u).includes(className));
    return image?.currentSrc || image?.src || null;
  };
  return { logo: url('game-logo'), thumbnail: url('game-cover-image') };
}

/** Build the second-load report from captured browser measurements. */
export function buildGamesCacheReport(run: CacheRun): GamesCacheReport {
  const matching = (url: string | undefined) => {
    if (!url) return null;
    const second = run.resources.find((item) => item.url === url);
    const first = run.firstResources?.find((item) => item.url === url);
    return second
      ? {
          ...second,
          cache:
            second.cache === 'cache (memory/disk unknown)' &&
            second.transferSize === 0 &&
            first &&
            first.transferSize > 0
              ? ('cache (memory/disk unknown)' as const)
              : second.cache,
        }
      : null;
  };
  const logo = matching(run.logoUrl);
  const thumbnail = matching(run.thumbnailUrl);
  return {
    game: run.game,
    viewport: { width: 390, height: 844 },
    logo,
    thumbnail,
    gamesListApi: run.api,
    ok: Boolean(
      logo &&
      thumbnail &&
      logo.status === 200 &&
      thumbnail.status === 200 &&
      logo.cache === 'cache (memory/disk unknown)' &&
      thumbnail.cache === 'cache (memory/disk unknown)' &&
      logo.transferSize === 0 &&
      thumbnail.transferSize === 0,
    ),
  };
}

/** Compare a published build with its predecessor; content-addressed unchanged files must stay cached. */
export function buildAfterPublishReport(input: {
  game: string;
  buildId: string;
  previousBuildId: string;
  previous: readonly BuildCacheEntry[];
  current: readonly BuildCacheEntry[];
  samples: readonly BuildCacheSample[];
}): AfterPublishReport {
  const previous = new Map(input.previous.map((entry) => [entry.sourcePath, entry]));
  const previousUrls = new Set(input.previous.map((entry) => entry.url));
  const currentPaths = new Set(input.current.map((entry) => entry.sourcePath));
  const currentUrls = new Set(input.current.map((entry) => entry.url));
  const transferred = new Map(input.samples.map((sample) => [sample.url, sample.transferSize]));
  const addedOrChanged = input.current.flatMap((entry) => {
    const old = previous.get(entry.sourcePath);
    return previousUrls.has(entry.url)
      ? []
      : [{ path: entry.sourcePath, from: old?.url ?? null, to: entry.url, bytes: transferred.get(entry.url) ?? 0 }];
  });
  const removed = input.previous.flatMap((entry) =>
    !currentPaths.has(entry.sourcePath) && !currentUrls.has(entry.url)
      ? [{ path: entry.sourcePath, from: entry.url, to: null, bytes: 0 }]
      : [],
  );
  const changedFiles = [...addedOrChanged, ...removed];
  const unexpectedTransfers = input.current.flatMap((entry) => {
    const bytes = transferred.get(entry.url) ?? 0;
    return previousUrls.has(entry.url) && bytes > 0 ? [{ path: entry.sourcePath, url: entry.url, bytes }] : [];
  });
  const unexpectedChanges = changedFiles.filter(
    ({ path }) => path !== 'index.html' && path !== 'manifest.json' && path !== 'assets/manifest.json',
  );
  return {
    game: input.game,
    buildId: input.buildId,
    previousBuildId: input.previousBuildId,
    totalBytesTransferred: [...new Set(input.current.map((entry) => entry.url))].reduce(
      (total, url) => total + (transferred.get(url) ?? 0),
      0,
    ),
    changedFiles,
    unexpectedChanges,
    unexpectedTransfers,
    ok: unexpectedChanges.length === 0 && unexpectedTransfers.length === 0,
  };
}
