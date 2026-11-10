import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { Icon } from '../../components/Icon';
import { AiBadge, withAiGeneratedLabel } from '../../components/AiBadge';
import { pickerFamilies, setsForFamily, type CatalogFamily, type StyleChoice } from './catalog';
import { FamilyStep } from './FamilyStep';
import { OtherTile } from './OtherTile';

type View =
  { kind: 'families' } | { kind: 'grid'; familyId: string } | { kind: 'detail'; familyId: string; setId: string };

type FocusTarget = { kind: 'family' | 'set'; id: string };

export function StyleStep({
  families,
  selected,
  other,
  full,
  allowAiGenerated,
  onAllowAiGeneratedChange,
  onFull,
  onOtherChange,
  onSelect,
}: {
  families: CatalogFamily[];
  selected: string[];
  other: string | undefined;
  full: boolean;
  allowAiGenerated: boolean;
  onAllowAiGeneratedChange(value: boolean): void;
  onFull(): void;
  onOtherChange(value: string | undefined): void;
  onSelect(id: string): void;
}) {
  const [view, setView] = useState<View>({ kind: 'families' });
  const root = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<FocusTarget | undefined>(undefined);
  const familyOptions = useMemo(() => pickerFamilies(families, allowAiGenerated), [allowAiGenerated, families]);
  const familyId = view.kind === 'families' ? undefined : view.familyId;
  const visibleSets = useMemo(
    () => (familyId ? setsForFamily(families, familyId, allowAiGenerated) : []),
    [allowAiGenerated, families, familyId],
  );

  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = undefined;
    root.current?.querySelector<HTMLButtonElement>(`[data-style-${target.kind}="${target.id}"]`)?.focus();
  }, [view]);

  const cycle = useCallback(
    (offset: number) => {
      if (view.kind !== 'detail' || visibleSets.length === 0) return;
      const index = visibleSets.findIndex((choice) => choice.id === view.setId);
      const next = visibleSets[(index + offset + visibleSets.length) % visibleSets.length]!;
      setView({ ...view, setId: next.id });
    },
    [view, visibleSets],
  );

  useEffect(() => {
    if (view.kind !== 'detail') return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.matches('input, textarea, select, [contenteditable="true"]')
      )
        return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        cycle(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cycle, view.kind]);

  const openFamily = (familyId: string) => {
    const choices = setsForFamily(families, familyId, allowAiGenerated);
    if (choices.length === 1) {
      setView({ kind: 'detail', familyId, setId: choices[0]!.id });
      return;
    }
    setView({ kind: 'grid', familyId });
  };

  const choose = (choice: StyleChoice) => {
    onSelect(choice.id);
    focusTarget.current = { kind: 'family', id: view.kind === 'detail' ? view.familyId : choice.familyId };
    setView({ kind: 'families' });
  };

  const active = view.kind === 'detail' ? visibleSets.find((choice) => choice.id === view.setId) : undefined;
  const familyLabel =
    view.kind === 'families' ? '' : (familyOptions.find((family) => family.id === view.familyId)?.label ?? 'styles');

  return (
    <div className="new-style-step" ref={root}>
      {view.kind !== 'detail' ? (
        <label className="new-style-ai-switch">
          <input
            type="checkbox"
            role="switch"
            checked={allowAiGenerated}
            onChange={(event) => onAllowAiGeneratedChange(event.currentTarget.checked)}
          />
          AI-generated assets
        </label>
      ) : null}
      {view.kind === 'families' ? (
        <div className="new-option-grid" role="group" aria-label="What should it look like?">
          <FamilyStep families={familyOptions} onOpen={openFamily} />
          <OtherTile title="Style" value={other} full={full} onFull={onFull} onChange={onOtherChange} />
        </div>
      ) : null}

      {view.kind === 'grid' ? (
        <div className="new-style-grid-view">
          <button
            className="new-style-icon-button tap-secondary"
            type="button"
            aria-label="Back to styles"
            onClick={() => {
              focusTarget.current = { kind: 'family', id: view.familyId };
              setView({ kind: 'families' });
            }}
          >
            <span aria-hidden="true">←</span>
          </button>
          <div className="new-style-set-grid" role="group" aria-label={`${familyLabel} sets`}>
            {visibleSets.map((choice) => (
              <SetTile
                key={choice.id}
                choice={choice}
                onOpen={() => setView({ kind: 'detail', familyId: view.familyId, setId: choice.id })}
              />
            ))}
          </div>
        </div>
      ) : null}

      {view.kind === 'detail' && active ? (
        <div className="new-style-detail" role="region" aria-label={active.label}>
          <ShowcaseDetail
            key={active.id}
            choice={active}
            onPreviousStyle={() => cycle(-1)}
            onNextStyle={() => cycle(1)}
          />
          <button
            className="new-style-select tap-primary"
            type="button"
            aria-label={`Select ${active.label}`}
            aria-pressed={selected.includes(active.id)}
            onClick={() => choose(active)}
          >
            Select
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SetTile({ choice, onOpen }: { choice: StyleChoice; onOpen(): void }) {
  const firstStop = choice.showcase?.stops[0];
  const previewPack = choice.packs.find((pack) => pack.thumbnailUrl);
  const showcasePreview = firstStop?.region?.gifUrl ?? firstStop?.region?.posterUrl ?? firstStop?.tileFallbackUrl;
  const preview = showcasePreview ?? previewPack?.thumbnailUrl;
  const generated =
    showcasePreview === undefined
      ? previewPack?.aiGenerated === true
      : choice.packs.length === 1 && choice.packs[0]?.aiGenerated === true;
  return (
    <button
      className="new-style-set tap-primary"
      type="button"
      aria-label={withAiGeneratedLabel(choice.label, generated)}
      data-style-set={choice.id}
      onClick={onOpen}
    >
      {preview ? <img src={preview} alt="" /> : <Icon name="other" className="new-option-icon" />}
      {generated ? <AiBadge /> : null}
    </button>
  );
}

function ShowcaseDetail({
  choice,
  onPreviousStyle,
  onNextStyle,
}: {
  choice: StyleChoice;
  onPreviousStyle(): void;
  onNextStyle(): void;
}) {
  const [activeStop, setActiveStop] = useState(0);
  const tile = useRef<HTMLVideoElement>(null);
  const sheet = useRef<HTMLVideoElement>(null);
  const showcase = choice.showcase;

  if (!showcase) {
    const previewPack = choice.packs.find((pack) => pack.thumbnailUrl);
    const preview = previewPack?.thumbnailUrl;
    return (
      <div className="new-style-showcase-detail">
        <div className="new-style-showcase">
          <StyleArrow direction="previous" onClick={onPreviousStyle} />
          <div className="new-style-still new-style-region-track">
            {preview ? (
              <img src={preview} alt={withAiGeneratedLabel(`${choice.label} preview`, previewPack?.aiGenerated)} />
            ) : (
              <Icon name="other" />
            )}
            {previewPack?.aiGenerated ? <AiBadge /> : null}
          </div>
          <StyleArrow direction="next" onClick={onNextStyle} />
        </div>
      </div>
    );
  }

  const outlineActive = Boolean(showcase.outlineOptions && activeStop === showcase.stops.length);
  const stop = showcase.stops[Math.min(activeStop, showcase.stops.length - 1)];
  const region = stop?.region;
  const sheetMedia = outlineActive ? showcase.outlineOptions?.sheet : stop?.sheet;
  const regionVideoUrl = region?.videoUrl ?? showcase.regionVideoUrl ?? showcase.tileVideoUrl;
  const sheetVideoUrl = sheetMedia?.videoUrl ?? showcase.sheetVideoUrl;
  const regionFallbackUrl = region?.gifUrl ?? stop?.tileFallbackUrl;
  const sheetFallbackUrl = sheetMedia?.gifUrl ?? stop?.sheetFallbackUrl;
  const regionPosterUrl = region?.posterUrl;
  const sheetPosterUrl = sheetMedia?.posterUrl;
  const startSeconds = stop?.startSeconds ?? 0;
  const aiGenerated = choice.packs.length === 1 && choice.packs[0]?.aiGenerated === true;

  const seek = (index: number) => {
    const next = showcase.stops[Math.min(index, showcase.stops.length - 1)];
    if (!next) return;
    setActiveStop(index);
    if (tile.current) tile.current.currentTime = next.startSeconds;
    if (sheet.current) sheet.current.currentTime = next.startSeconds;
  };

  const cycleScene = (offset: number) => {
    const count = showcase.stops.length + (showcase.outlineOptions ? 1 : 0);
    if (count === 0) return;
    seek((activeStop + offset + count) % count);
  };

  return (
    <div className="new-style-showcase-detail">
      <div className="new-style-showcase">
        <StyleArrow direction="previous" onClick={onPreviousStyle} />
        <ShowcaseTrack
          key={regionVideoUrl ?? regionFallbackUrl ?? regionPosterUrl ?? 'region'}
          className="new-style-region-track"
          label="Diorama preview"
          videoUrl={regionVideoUrl}
          fallbackUrl={regionFallbackUrl}
          posterUrl={regionPosterUrl}
          startSeconds={startSeconds}
          fallbackAlt={`${stop?.label ?? choice.label} diorama fallback`}
          videoRef={tile}
          onTimeUpdate={
            outlineActive
              ? undefined
              : () => {
                  if (
                    tile.current &&
                    sheet.current &&
                    Math.abs(tile.current.currentTime - sheet.current.currentTime) > 0.12
                  )
                    sheet.current.currentTime = tile.current.currentTime;
                }
          }
          aiGenerated={aiGenerated}
        />
        <StyleArrow direction="next" onClick={onNextStyle} />
        <ShowcaseTrack
          key={sheetVideoUrl ?? sheetFallbackUrl ?? sheetPosterUrl ?? 'sheet'}
          className="new-style-sheet-track"
          label="Sprite sheets preview"
          videoUrl={sheetVideoUrl}
          fallbackUrl={sheetFallbackUrl}
          posterUrl={sheetPosterUrl}
          startSeconds={outlineActive ? 0 : startSeconds}
          fallbackAlt={`${outlineActive ? showcase.outlineOptions?.label : (stop?.label ?? choice.label)} sprite sheets fallback`}
          videoRef={sheet}
          aiGenerated={aiGenerated}
        />
      </div>
      <div className="new-style-scene-row">
        <button
          className="new-style-scene-button tap-secondary"
          type="button"
          aria-label="Previous scene"
          onClick={() => cycleScene(-1)}
        >
          <span aria-hidden="true">|‹</span>
        </button>
        <div className="new-style-stops" role="group" aria-label="Showcase regions">
          {showcase.stops.map((candidate, index) => (
            <button
              className="new-style-stop"
              type="button"
              aria-label={withAiGeneratedLabel(candidate.label, aiGenerated)}
              aria-pressed={index === activeStop}
              onClick={() => seek(index)}
              key={candidate.id}
            >
              {candidate.region?.posterUrl || candidate.region?.gifUrl || candidate.tileFallbackUrl ? (
                <img
                  src={candidate.region?.posterUrl ?? candidate.region?.gifUrl ?? candidate.tileFallbackUrl}
                  alt=""
                  loading="eager"
                  decoding="sync"
                />
              ) : null}
              {aiGenerated ? <AiBadge /> : null}
            </button>
          ))}
          {showcase.outlineOptions ? (
            <button
              className="new-style-stop"
              type="button"
              aria-label={withAiGeneratedLabel(showcase.outlineOptions.label, aiGenerated)}
              aria-pressed={outlineActive}
              onClick={() => seek(showcase.stops.length)}
            >
              {showcase.outlineOptions.sheet.posterUrl || showcase.outlineOptions.sheet.gifUrl ? (
                <img
                  src={showcase.outlineOptions.sheet.posterUrl ?? showcase.outlineOptions.sheet.gifUrl}
                  alt=""
                  loading="eager"
                  decoding="sync"
                />
              ) : null}
              {aiGenerated ? <AiBadge /> : null}
            </button>
          ) : null}
        </div>
        <button
          className="new-style-scene-button tap-secondary"
          type="button"
          aria-label="Next scene"
          onClick={() => cycleScene(1)}
        >
          <span aria-hidden="true">›|</span>
        </button>
      </div>
    </div>
  );
}

function StyleArrow({ direction, onClick }: { direction: 'previous' | 'next'; onClick(): void }) {
  const previous = direction === 'previous';
  return (
    <button
      className={`new-style-icon-button new-style-style-button new-style-style-${direction} tap-secondary`}
      type="button"
      aria-label={`${previous ? 'Previous' : 'Next'} style`}
      onClick={onClick}
    >
      <span aria-hidden="true">{previous ? '‹' : '›'}</span>
    </button>
  );
}

function ShowcaseTrack({
  className,
  label,
  videoUrl,
  fallbackUrl,
  posterUrl,
  startSeconds,
  fallbackAlt,
  videoRef,
  onTimeUpdate,
  aiGenerated,
}: {
  className: string;
  label: string;
  videoUrl: string | undefined;
  fallbackUrl: string | undefined;
  posterUrl: string | undefined;
  startSeconds: number;
  fallbackAlt: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  onTimeUpdate?(): void;
  aiGenerated: boolean;
}) {
  const [ready, setReady] = useState(false);
  return (
    <div className={`new-style-track ${className}`} data-ready={ready}>
      {fallbackUrl || posterUrl ? (
        <img
          src={fallbackUrl ?? posterUrl}
          alt={withAiGeneratedLabel(fallbackAlt, aiGenerated)}
          onError={(event) => {
            if (posterUrl && event.currentTarget.src !== new URL(posterUrl, window.location.href).href)
              event.currentTarget.src = posterUrl;
          }}
        />
      ) : (
        <Icon name="other" />
      )}
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          poster={posterUrl}
          aria-label={withAiGeneratedLabel(label, aiGenerated)}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = startSeconds;
          }}
          onCanPlay={() => setReady(true)}
          onError={() => setReady(false)}
          onTimeUpdate={onTimeUpdate}
        />
      ) : null}
      {aiGenerated ? <AiBadge /> : null}
    </div>
  );
}
