import type { QueryClient } from '@tanstack/react-query';

type TestRouter = {
  navigate(to: string): unknown;
  state: { location: { pathname: string } };
};

export type OgmHost = {
  version: 1;
  route(): string;
  navigate(to: string): void;
  register(name: string, api: object): void;
  get(name: string): object | undefined;
  snapshot(): { route: string; registered: string[] };
  admin?: { readonly route: string; readonly lastTimeline: unknown };
  activity?: { settled(creatorId: string, gameIds: string[]): boolean };
};

declare global {
  interface Window {
    __ogmHost?: OgmHost;
  }
}

export function installTestHook(router: TestRouter, queryClient?: QueryClient): OgmHost | undefined {
  if (!new URLSearchParams(window.location.search).has('test')) {
    return undefined;
  }

  const registry = new Map<string, object>();
  const host: OgmHost = {
    version: 1,
    route: () => router.state.location.pathname,
    navigate: (to) => {
      void router.navigate(to);
    },
    register: (name, api) => {
      if (registry.has(name)) {
        throw new Error(`test API ${name} is already registered`);
      }
      registry.set(name, api);
    },
    get: (name) => registry.get(name),
    snapshot: () => ({
      route: router.state.location.pathname,
      registered: [...registry.keys()].sort(),
    }),
  };

  if (queryClient) {
    host.activity = {
      settled: (creatorId: string, gameIds: string[]) => activityFeedsSettled(queryClient, creatorId, gameIds),
    };
  }
  window.__ogmHost = host;
  return host;
}

function activityFeedsSettled(queryClient: QueryClient, creatorId: string, gameIds: string[]): boolean {
  if (!creatorId || !gameIds.length) return false;
  return gameIds.every((id) =>
    [
      ['game-workers', creatorId, id],
      ['game-review-rounds', id, creatorId],
      ['game-previews', id, creatorId],
      ['completed-tickets', creatorId, id],
    ].every((key) => {
      const state = queryClient.getQueryState<Record<string, unknown>>(key);
      return (
        state?.status === 'success' &&
        state.fetchStatus === 'idle' &&
        !state.data?.stale &&
        !state.data?.daemonUnavailable &&
        !state.data?.trackerStale
      );
    }),
  );
}

export function registerTestApi(name: string, api: object): void {
  window.__ogmHost?.register(name, api);
}
