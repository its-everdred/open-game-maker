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
