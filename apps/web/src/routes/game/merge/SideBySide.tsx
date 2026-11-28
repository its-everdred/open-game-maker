import { useEffect, useRef, useState } from 'react';

import { requestDraftGrant, type DesignSnapshot } from '../../../features/editor/api';
import { mountGameFrame, type GameFrameController, type GameFrameState } from '../../../features/editor/frame';

export function SideBySide({
  gameId,
  entityId,
  mine,
  theirs,
  mineValue,
  theirsValue,
}: {
  gameId: string;
  entityId?: string;
  mine: DesignSnapshot;
  theirs: DesignSnapshot;
  mineValue: unknown;
  theirsValue: unknown;
}) {
  return (
    <div className="merge-side-by-side">
      <FramePreview label="Mine" gameId={gameId} entityId={entityId} snapshot={mine} fallbackValue={mineValue} />
      <FramePreview label="Theirs" gameId={gameId} entityId={entityId} snapshot={theirs} fallbackValue={theirsValue} />
    </div>
  );
}

export function FramePreview({
  label,
  gameId,
  entityId,
  snapshot,
  fallbackValue,
}: {
  label: string;
  gameId: string;
  entityId?: string;
  snapshot: DesignSnapshot;
  fallbackValue?: unknown;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GameFrameState>({ bridgeState: 'connecting', dropped: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const live: { controller?: GameFrameController } = {};
    let cancelled = false;
    void requestDraftGrant(gameId, snapshot.buildId)
      .then(({ grant }) => {
        if (cancelled) return;
        const controller = mountGameFrame({
          container,
          gamesOrigin: import.meta.env.VITE_GAMES_ORIGIN ?? 'http://127.0.0.1:10000',
          gameId,
          buildId: snapshot.buildId,
          draftGrant: grant,
          mode: 'play',
          build: 'test',
          design: snapshot,
          onState: (next) => {
            setState(next);
            if (next.bridgeState === 'ready' && entityId !== undefined) live.controller?.select([entityId]);
          },
        });
        live.controller = controller;
      })
      .catch(() => {
        if (!cancelled) setState({ bridgeState: 'error', dropped: 0 });
      });
    return () => {
      cancelled = true;
      live.controller?.dispose();
    };
  }, [entityId, gameId, snapshot]);

  return (
    <section className="merge-frame-preview" aria-label={label}>
      <h3>{label}</h3>
      <div className="merge-frame" ref={containerRef} hidden={state.bridgeState === 'error'} />
      {state.bridgeState === 'connecting' ? <p>Loading {label.toLocaleLowerCase()} preview…</p> : null}
      {state.bridgeState === 'error' ? (
        <p role="status">
          {label} preview unavailable: {displayValue(fallbackValue)}
        </p>
      ) : null}
    </section>
  );
}

export function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}
