import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api/client';

export function MissingMedia({ path }: { path: string }) {
  const [status, setStatus] = useState<'sending' | 'asked' | 'error' | 'changed'>('sending');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus('sending');
    void api(path, { method: 'POST' }).then(
      () => {
        if (active) setStatus('asked');
      },
      (error: unknown) => {
        if (active) setStatus(error instanceof ApiError && error.status === 409 ? 'changed' : 'error');
      },
    );
    return () => {
      active = false;
    };
  }, [path, attempt]);
  return (
    <div role="alert">
      {status === 'asked'
        ? 'No media; asked the agent.'
        : status === 'sending'
          ? 'No media; asking the agent…'
          : status === 'changed'
            ? 'Review changed or media is still loading.'
            : 'No media; could not reach the agent.'}
      {status === 'error' && (
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      )}
    </div>
  );
}
