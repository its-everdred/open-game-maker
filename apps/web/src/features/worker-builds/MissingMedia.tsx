import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api/client';

type Status = 'sending' | 'asked' | 'error' | 'changed';

export function useMissingMedia(paths: readonly string[]) {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const requested = useRef(new Set<string>());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const request = (path: string) => {
    requested.current.add(path);
    setStatuses((previous) => ({ ...previous, [path]: 'sending' }));
    void api(path, { method: 'POST' }).then(
      () => {
        if (mounted.current) setStatuses((previous) => ({ ...previous, [path]: 'asked' }));
      },
      (error: unknown) => {
        if (mounted.current)
          setStatuses((previous) => ({
            ...previous,
            [path]: error instanceof ApiError && error.status === 409 ? 'changed' : 'error',
          }));
      },
    );
  };
  const pathKey = JSON.stringify(paths);
  useEffect(() => {
    for (const path of JSON.parse(pathKey) as string[]) if (!requested.current.has(path)) request(path);
  }, [pathKey]);
  return { statuses, retry: request };
}

export function MissingMediaStatus({ status, onRetry }: { status?: Status; onRetry(): void }) {
  return (
    <div role="alert">
      {status === 'asked'
        ? 'Asked the agent for media in the next round.'
        : status === 'sending' || !status
          ? 'No media; asking the agent…'
          : status === 'changed'
            ? 'Review changed or media is still loading.'
            : 'No media; could not reach the agent.'}
      {status === 'error' && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function MissingMedia({ path }: { path: string }) {
  const { statuses, retry } = useMissingMedia([path]);
  return <MissingMediaStatus status={statuses[path]} onRetry={() => retry(path)} />;
}
