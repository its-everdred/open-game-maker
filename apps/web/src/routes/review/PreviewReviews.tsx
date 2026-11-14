import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import type { DesignDoc } from '@ogm/contracts/browser';

import { queryClient } from '../../app/query';
import { mountGameFrame } from '../../features/editor/frame';
import { api } from '../../lib/api/client';

export type Preview = {
  ticket: string;
  buildId: string;
  accessId: string;
  createdAt: string;
  pendingMessage?: string;
  title?: string;
  question?: string;
};
const key = (gameId: string) => ['game-previews', gameId] as const;

export function usePreviews(gameId: string) {
  return useQuery({
    queryKey: key(gameId),
    queryFn: () => api<{ previews: Preview[] }>(`/games/${encodeURIComponent(gameId)}/previews`),
    refetchInterval: 5000,
    retry: false,
  });
}

export function PreviewReviews({ gameId, previews }: { gameId: string; previews: Preview[] }) {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash.startsWith('#preview-')) {
      try {
        document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
      } catch {
        // An invalid fragment cannot identify a preview.
      }
    }
  }, [hash, previews]);
  return (
    <>
      {previews.map((preview) => (
        <PreviewCard key={preview.buildId} gameId={gameId} preview={preview} />
      ))}
    </>
  );
}

function PreviewCard({ gameId, preview }: { gameId: string; preview: Preview }) {
  const container = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('');
  const pending = /^Preview review of preview-[0-9a-f-]{36}: (looks right|needs work)\.(?:\n([\s\S]*))?$/u.exec(
    preview.pendingMessage ?? '',
  );
  const actualNote = pending ? (pending[2] ?? '') : note;
  const [frameError, setFrameError] = useState(false);
  const path = `/games/${encodeURIComponent(gameId)}/previews/${encodeURIComponent(preview.ticket)}`;
  const design = useQuery({
    queryKey: ['preview-design', gameId, preview.buildId],
    queryFn: () =>
      api<{ rev: number; doc: DesignDoc }>(`${path}/design?buildId=${encodeURIComponent(preview.buildId)}`),
    retry: false,
  });
  const answer = useMutation({
    mutationFn: (verdict: 'looks right' | 'needs work') =>
      api(`${path}/answer`, {
        method: 'POST',
        json: { buildId: preview.buildId, verdict, ...(actualNote.trim() ? { note: actualNote } : {}) },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(gameId) }),
    onError: () => queryClient.invalidateQueries({ queryKey: key(gameId) }),
  });
  useEffect(() => {
    if (!container.current || !design.data) return;
    const frame = mountGameFrame({
      container: container.current,
      gamesOrigin: import.meta.env.VITE_GAMES_ORIGIN ?? 'http://127.0.0.1:10000',
      gameId,
      buildId: preview.accessId,
      preview: true,
      mode: 'play',
      design: design.data,
      onState: (state) => setFrameError(state.bridgeState === 'error'),
    });
    return () => frame.dispose();
  }, [design.data, gameId, preview.accessId]);
  return (
    <section
      id={`preview-${preview.buildId}`}
      className="review-deck"
      aria-label={`Preview for ticket ${preview.ticket}`}
    >
      <div className="review-deck-playable">
        <div className="review-deck-playable-frame" ref={container} />
        {frameError || design.isError ? <p role="status">The game did not load.</p> : null}
      </div>
      {preview.question ? <p>{preview.question}</p> : null}
      <label>
        Note (optional)
        <textarea
          value={actualNote}
          readOnly={pending !== null}
          maxLength={3900}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="review-deck-actions">
        <button
          type="button"
          disabled={answer.isPending || (pending !== null && pending[1] !== 'looks right')}
          onClick={() => answer.mutate('looks right')}
        >
          Looks right
        </button>
        <button
          type="button"
          disabled={answer.isPending || (pending !== null && pending[1] !== 'needs work')}
          onClick={() => answer.mutate('needs work')}
        >
          Needs work
        </button>
      </div>
      {answer.isError || pending ? (
        <p role="alert">The review may not have sent. Tap the same verdict to retry.</p>
      ) : null}
    </section>
  );
}
