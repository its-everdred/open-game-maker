import { useQuery } from '@tanstack/react-query';
import type { DesignDoc } from '@ogm/contracts';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { mountGameFrame, type GameFrameState } from '../../features/editor/frame';
import { api } from '../../lib/api/client';
import '../../features/commands-inbox/review-deck.css';
import '../slice/slice.css';

type LiveAccess = { gameId: string; accessId: string; version: string; design: { rev: number; doc: DesignDoc } };

export function LiveScreen() {
  const { slug = '', ticket = '' } = useParams();
  const [search] = useSearchParams();
  const scenario = search.get('scenario')?.trim();
  const game = useQuery({
    queryKey: ['live-resolve', slug, ticket],
    queryFn: async () =>
      (
        await api<{ game: { id: string } }>(
          `/games/live-resolve/${encodeURIComponent(slug)}/${encodeURIComponent(ticket)}`,
        )
      ).game,
    enabled: Boolean(slug && ticket),
    retry: false,
  });
  const access = useQuery({
    queryKey: ['live-access', game.data?.id, ticket],
    queryFn: () => api<LiveAccess>(`/games/${encodeURIComponent(game.data!.id)}/live/${encodeURIComponent(ticket)}`),
    enabled: !!game.data?.id && !!ticket,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GameFrameState['bridgeState']>('connecting');
  // A cached capability points at an earlier generation. Wait for the fresh lookup on each visit.
  const live = access.isFetching || access.isError ? undefined : access.data;
  useEffect(() => {
    if (!container.current || !live) return;
    const frame = mountGameFrame({
      container: container.current,
      gamesOrigin: import.meta.env.VITE_GAMES_ORIGIN ?? 'http://127.0.0.1:10000',
      gameId: live.gameId,
      buildId: live.accessId,
      live: true,
      liveVersion: live.version,
      mode: 'play',
      design: live.design,
      params: scenario ? { scenario } : {},
      onState: (next) => setState(next.bridgeState),
    });
    return () => frame.dispose();
  }, [live, scenario]);
  return (
    <main className="slice-screen review-deck-playable">
      <div className="review-deck-playable-frame" ref={container} />
      {game.isError || access.isError || state === 'error' ? (
        <p className="review-deck-playable-state slice-screen-state" role="status">
          The game did not load.
        </p>
      ) : null}
    </main>
  );
}
