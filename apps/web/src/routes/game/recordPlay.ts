import { api } from '../../lib/api/client';

// Serialize this client's writes so a slow earlier request cannot overtake a newer play.
let pending: Promise<void> = Promise.resolve();

export function recordPlay(gameId: string, signal?: AbortSignal): Promise<void> {
  const result = pending.then(() => sendPlay(gameId, signal));
  pending = result.catch(() => {});
  return result;
}

async function sendPlay(gameId: string, signal?: AbortSignal): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await api(`/games/${encodeURIComponent(gameId)}/play`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
      return;
    } catch (error) {
      if (signal?.aborted || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      if (signal?.aborted) throw error;
    }
  }
}
