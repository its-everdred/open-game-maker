import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkerBuild } from './BuildTracker';
import type { WorkerFeed } from './useWorkers';

export type FinishedWorker = { ticket: string; title: string };
type SeenWorker = FinishedWorker & { gameId: string; rawTicket: string; startedAt?: string };

export function useWorkerFinishes(workers: readonly WorkerBuild[], feeds: readonly WorkerFeed[], scope = '') {
  const seen = useRef(new Map<string, SeenWorker>());
  const seenScope = useRef(scope);
  const [state, setState] = useState<{ scope: string; finished: FinishedWorker[] }>({ scope, finished: [] });
  useEffect(() => {
    if (seenScope.current !== scope) {
      seen.current.clear();
      seenScope.current = scope;
      setState({ scope, finished: [] });
    }
    const active = new Set(workers.map((worker) => worker.ticket));
    for (const worker of workers) {
      const prior = seen.current.get(worker.ticket);
      if (prior && prior.startedAt === worker.startedAt) continue;
      const feed = feeds.find(({ gameId }) => worker.ticket.startsWith(`${gameId}:`));
      if (!feed) continue;
      const rawTicket = worker.ticket.slice(feed.gameId.length + 1);
      if (!prior && seen.current.size >= 200) seen.current.delete(seen.current.keys().next().value!);
      seen.current.set(worker.ticket, {
        ...worker,
        gameId: feed.gameId,
        rawTicket,
      });
    }
    const newlyFinished: FinishedWorker[] = [];
    for (const [ticket, prior] of seen.current) {
      if (active.has(ticket)) continue;
      const feed = feeds.find(({ gameId }) => gameId === prior.gameId);
      const start = Date.parse(prior.startedAt ?? '');
      if (
        !Number.isFinite(start) ||
        !feed?.completed.some(
          (event) =>
            event.ticket === prior.rawTicket && Number.isFinite(Date.parse(event.at)) && Date.parse(event.at) >= start,
        )
      )
        continue;
      newlyFinished.push({ ticket, title: prior.title });
      seen.current.delete(ticket);
    }
    if (newlyFinished.length)
      setState((current) => ({
        scope,
        finished: [...(current.scope === scope ? current.finished : []), ...newlyFinished],
      }));
  }, [workers, feeds, scope]);
  const dismiss = useCallback(
    (tickets?: readonly string[]) =>
      setState((current) => ({
        scope,
        finished:
          current.scope === scope && tickets ? current.finished.filter((item) => !tickets.includes(item.ticket)) : [],
      })),
    [scope],
  );
  return { finished: state.scope === scope ? state.finished : [], dismiss };
}
