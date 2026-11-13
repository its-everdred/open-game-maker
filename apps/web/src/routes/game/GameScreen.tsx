import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams, useSearchParams } from 'react-router';

import type { CreateJobRequest, Entity, ReapplyReport } from '@ogm/contracts/browser';

import type { OgmHost } from '../../app/testHook';
import { useGameMenu, useGameMenuControls } from '../../app/GameMenu';
import { useDock } from '../../features/build-chat/dock';
import { editJobRequest } from '../../features/build-chat/edit';
import { gameJobsQueryKey, myJobsQueryKey } from '../../features/build-chat/jobs';
import {
  getDesignSnapshot,
  getGame,
  getFallbackPalette,
  getEditorPreviews,
  getEditorStage,
  getPreviewDesign,
  getScenerySource,
  getOptionalReapply,
  listJobs,
  postAnalyticsEvent,
  NO_BUILD_ID,
  submitReapply,
  type DesignSnapshot,
} from '../../features/editor/api';
import { inspectBuildChange, readyBuildSignal } from '../../features/editor/builds';
import { EditorChrome } from '../../features/editor/EditorChrome';
import { EDITOR_FOCUS_ZONES } from '../../features/editor/focus';
import { FocusZone } from '../../lib/input';
import { fallbackEditRequest, previewEditRequest } from '../../features/editor/fallback-request';
import { GizmoOverlay } from '../../features/editor/GizmoOverlay';
import { changeInstanceCount } from '../../features/editor/instanceCount';
import {
  mountGameFrame,
  type GameFrameController,
  type GameFrameState,
  type GameLoadMeasurement,
} from '../../features/editor/frame';
import { ReapplyCard } from '../../features/editor/ReapplyCard';
import type { EditorSessionState } from '../../features/editor/session';
import { useEditorSession } from '../../features/editor/use-editor-session';
import { mountSceneryPreview } from '../../features/editor/scenery-preview';
import { resolvePaletteThumbnails } from '../../features/editor/palette-thumbnails';
import { containedStagePoint, mountStagePreview } from '../../features/editor/stage-preview';
import { admitJob } from '../../features/scope-chat/admit';
import { energyRefusalText } from '../../features/energy/api';
import type { SnapPrefs } from '../../features/editor/SnapPrefs';
import {
  createEntityIntent,
  createIntent,
  createStableId,
  deleteEntityIntent,
} from '../../features/editor/transactions';
import { pushToast } from '../../lib/notify/slice';
import { DiagnosticsOverlay } from '../../net/diagnostics/DiagnosticsOverlay';
import { RoomLayer } from '../../features/room/RoomLayer';
import { useRoomRuntime } from '../../features/room/useRoomRuntime';
import { useBranches } from '../games/useBranches';
import { clearRoomGrant, storeRoomGrant } from '../join/grant-store';
import { LoadingLayer } from './LoadingLayer';
import { gameLoadActivity } from './load-analytics';
import { PlatformHud } from './PlatformHud';
import { roomFacts } from './room-facts';
import { UpdateIndicator } from './UpdateIndicator';
import { gameExtras, type GameExtraProps } from './extras';
import './game.css';
import './game-prototype.css';

const initialFrameState: GameFrameState = { bridgeState: 'connecting', dropped: 0 };

type GameTestState = {
  bridgeState: GameFrameState['bridgeState'];
  headRev: number;
  lastSaveAt?: string;
  saved: string;
  mode: 'play' | 'edit';
  selection: string[];
  dropped: number;
  readOnly: boolean;
};

type TestHost = OgmHost & { game?: GameTestState };

export function GameScreen() {
  const queryClient = useQueryClient();
  const { gameId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { open: menuOpen, setOpen: setMenuOpen } = useGameMenu();
  const branch = searchParams.get('v')?.trim() || 'main';
  const roomId = searchParams.get('room')?.trim() || undefined;
  const mode: 'play' | 'edit' = searchParams.get('mode') === 'edit' ? 'edit' : 'play';
  const gamesOrigin = import.meta.env.VITE_GAMES_ORIGIN ?? 'http://127.0.0.1:10000';
  const game = useQuery({ queryKey: ['game', gameId], queryFn: () => getGame(gameId), enabled: gameId !== '' });
  const design = useQuery({
    queryKey: ['design', gameId, branch],
    queryFn: () => getDesignSnapshot(gameId, branch),
    enabled: gameId !== '',
  });
  const jobs = useQuery({
    queryKey: gameJobsQueryKey(gameId),
    queryFn: () => listJobs(gameId),
    enabled: gameId !== '',
    refetchInterval: 5_000,
  });
  const branches = useBranches(gameId === '' ? null : gameId);
  // Games open with the branch id in `v`; job admission only takes the canonical name of the main branch.
  const jobBranch = branches.data?.find(({ id }) => id === branch)?.name === 'main' ? 'main' : branch;
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<GameFrameController | undefined>(undefined);
  const [frameController, setFrameController] = useState<GameFrameController>();
  const [frameState, setFrameState] = useState(initialFrameState);
  const [frameAttempt, setFrameAttempt] = useState(0);
  const [canvasOptions, setCanvasOptions] = useState<{ prefab?: string; snap: SnapPrefs }>();
  const fallbackInFlight = useRef(false);
  const [adopted, setAdopted] = useState<{ gameId: string; branch: string; snapshot: DesignSnapshot }>();
  const [pendingBuild, setPendingBuild] = useState<{ snapshot: DesignSnapshot; report: ReapplyReport }>();
  const [publishedBuildId, setPublishedBuildId] = useState<string>();
  const [lastSaveAt, setLastSaveAt] = useState<string>();
  /* Outlives the watcher overlay (unmounted while playing); a new frame starts its game on the default follow camera. */
  const [watcherCamera, setWatcherCamera] = useState<'follow' | 'free'>('follow');
  const inspectedBuildRef = useRef<string | undefined>(undefined);
  const inspectedJobRef = useRef<string | undefined>(undefined);
  const activeSnapshot = adopted?.gameId === gameId && adopted.branch === branch ? adopted.snapshot : design.data;
  const noBuild = activeSnapshot?.buildId === NO_BUILD_ID;
  const previews = useQuery({
    queryKey: ['editor-previews', gameId],
    queryFn: () => getEditorPreviews(gameId),
    enabled: gameId !== '' && noBuild,
    refetchInterval: 5_000,
    retry: false,
  });
  const candidatePreview = noBuild
    ? previews.data?.previews.find((preview) => preview.branchId === jobBranch)
    : undefined;
  const previewDesign = useQuery({
    queryKey: ['preview-design', gameId, candidatePreview?.buildId],
    queryFn: () => getPreviewDesign(gameId, candidatePreview!.ticket, candidatePreview!.buildId),
    enabled: candidatePreview !== undefined,
    retry: false,
  });
  const waitingForPreview =
    noBuild && (previews.isPending || (candidatePreview !== undefined && previewDesign.isPending));
  const activePreview = candidatePreview && previewDesign.data ? candidatePreview : undefined;
  const stage = useQuery({
    queryKey: ['editor-stage', gameId, jobBranch],
    queryFn: () => getEditorStage(gameId, jobBranch),
    enabled: gameId !== '' && noBuild && !waitingForPreview && !activePreview,
    refetchInterval: 60_000,
    retry: false,
  });
  const waitingForStage = noBuild && !waitingForPreview && !activePreview && stage.isPending;
  const scenerySource = useQuery({
    queryKey: ['scenery-source', gameId, jobBranch],
    queryFn: () => getScenerySource(gameId, jobBranch),
    enabled:
      gameId !== '' &&
      ((noBuild && !waitingForPreview && !waitingForStage && !activePreview) ||
        (mode === 'edit' && !!frameState.manifest?.capabilities.includes('scenery'))),
    retry: false,
    refetchInterval: noBuild && !activePreview ? 5_000 : false,
  });
  const hasScenery =
    (scenerySource.data?.scene.items.length ?? 0) > 0 ||
    (scenerySource.data?.scene.terrain.length ?? 0) > 0 ||
    Object.values(activeSnapshot?.doc.entities ?? {}).some((entity) => entity.prefab.startsWith('scenery:'));
  const stageAt = Date.parse(stage.data?.stage?.at ?? '');
  const sceneryAt = Date.parse(scenerySource.data?.updatedAt ?? '');
  const newerScenery =
    hasScenery && (!Number.isFinite(stageAt) || (Number.isFinite(sceneryAt) && sceneryAt >= stageAt));
  const waitingForScenery =
    noBuild &&
    !waitingForPreview &&
    !waitingForStage &&
    !activePreview &&
    stage.data?.stage?.kind === 'image' &&
    scenerySource.isPending;
  const activeStage =
    noBuild && !activePreview && !waitingForScenery && !(newerScenery && stage.data?.stage?.kind === 'image')
      ? (stage.data?.stage ?? undefined)
      : undefined;
  const requestOnlySnapshot = useMemo(
    () =>
      activePreview && previewDesign.data
        ? { ...previewDesign.data, buildId: NO_BUILD_ID }
        : noBuild
          ? activeSnapshot
          : undefined,
    [activePreview?.buildId, previewDesign.data, noBuild, activeSnapshot],
  );
  const previewSource = noBuild && !activePreview && !activeStage ? scenerySource.data : undefined;
  const previewSourceError = noBuild && !activePreview && !activeStage && scenerySource.isError;
  const nativePalette = frameState.manifest?.palette;
  const nativePaletteEmpty =
    nativePalette !== undefined && nativePalette.categories.length === 0 && nativePalette.items.length === 0;
  const fallback = useQuery({
    queryKey: ['editor-fallback', gameId],
    queryFn: () => getFallbackPalette(gameId),
    enabled: gameId !== '' && mode === 'edit' && nativePaletteEmpty,
    retry: false,
  });
  const fallbackActive = nativePaletteEmpty && fallback.data?.mode === 'request';
  const sideBranch =
    branches.data?.some(({ id, name }) => (id === branch || name === branch) && name !== 'main') === true;
  const sidePreview = noBuild && sideBranch && !fallbackActive && !activeStage;
  const requestOnly = fallbackActive || (noBuild && !sidePreview);
  const editorManifest = useMemo(() => {
    if (!frameState.manifest) return undefined;
    const manifest =
      fallbackActive && fallback.data
        ? { ...frameState.manifest, palette: fallback.data.palette }
        : frameState.manifest;
    const buildId = activePreview?.accessId ?? activeSnapshot?.buildId;
    if (mode !== 'edit' || fallbackActive || !buildId || (noBuild && !activePreview)) return manifest;
    return resolvePaletteThumbnails(manifest, gamesOrigin, gameId, buildId, !!activePreview);
  }, [
    frameState.manifest,
    fallbackActive,
    fallback.data,
    activePreview,
    activeSnapshot?.buildId,
    noBuild,
    gamesOrigin,
    gameId,
    mode,
  ]);
  const submitEditRequest = useCallback(
    (request: CreateJobRequest) => {
      if (request.branchId !== 'main') {
        pushToast('Changes to this version stay in the preview.');
        return;
      }
      if (fallbackInFlight.current) return;
      fallbackInFlight.current = true;
      void admitJob(request)
        .then((result) => {
          if (result.kind === 'refused') {
            pushToast(energyRefusalText(result.window) ?? 'The build could not be started.');
            return;
          }
          void queryClient.invalidateQueries({ queryKey: gameJobsQueryKey(gameId) });
          void queryClient.invalidateQueries({ queryKey: myJobsQueryKey });
        })
        .catch(() => pushToast('The build could not be started.'))
        .finally(() => {
          fallbackInFlight.current = false;
        });
    },
    [gameId, queryClient],
  );
  const requestLight = useCallback(
    (preset: 'warm-forest' | 'night' | 'cave') => {
      submitEditRequest(
        editJobRequest(
          { gameId, branchId: jobBranch },
          `Set the scene lighting to ${preset}.`,
          'now',
          `edit:${crypto.randomUUID()}`,
        ),
      );
    },
    [gameId, jobBranch, submitEditRequest],
  );
  const requestFallbackPlacement = useCallback(
    (prefab: string, point: { x: number; y: number }, path?: Array<{ x: number; y: number }>) => {
      if (activeStage) {
        const media = containerRef.current?.querySelector('img, video');
        if (!(media instanceof HTMLImageElement || media instanceof HTMLVideoElement)) return;
        const width = media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth;
        const height = media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight;
        const rect = media.getBoundingClientRect();
        const mapped = containedStagePoint(point, rect.width, rect.height, width, height);
        if (!mapped) return;
        point = mapped;
      }
      const palette = fallbackActive ? fallback.data?.palette : frameState.manifest?.palette;
      const item = palette?.items.find((candidate) => candidate.prefab === prefab);
      if (!item || fallbackInFlight.current) return;
      try {
        const target = { gameId, branchId: jobBranch };
        const key = `edit:${crypto.randomUUID()}`;
        if (path && path.length > 1 && !activeStage) {
          const count = Math.min(path.length, 60);
          const points = Array.from({ length: count }, (_, i) => {
            const point = path[Math.round((i * (path.length - 1)) / (count - 1))]!;
            return [Number(point.x.toFixed(3)), Number(point.y.toFixed(3))];
          });
          submitEditRequest(
            editJobRequest(
              target,
              `Draw ${JSON.stringify(item.label).slice(0, 300)} (${JSON.stringify(prefab).slice(0, 500)}) along normalized preview coordinates ${JSON.stringify(points)}.`,
              'now',
              key,
            ),
          );
          return;
        }
        const request =
          fallbackActive && !prefab.startsWith('scope:')
            ? fallbackEditRequest(target, { assetId: prefab, name: item.label, ...point }, key)
            : previewEditRequest(target, { prefab, name: item.label, ...point }, key);
        submitEditRequest(request);
      } catch {
        pushToast('The build could not be started.');
      }
    },
    [activeStage, fallback.data, fallbackActive, frameState.manifest, gameId, jobBranch, submitEditRequest],
  );
  const build = publishedBuildId !== undefined && publishedBuildId === activeSnapshot?.buildId ? 'published' : 'draft';
  const room = useRoomRuntime({ frame: frameController, roomId, testMode: searchParams.has('test') });
  const reportGameLoad = useCallback(
    (measurement: GameLoadMeasurement, result: 'ok' | 'fail') => {
      void postAnalyticsEvent(gameLoadActivity(gameId, measurement, result)).catch(() => undefined);
    },
    [gameId],
  );

  useEffect(() => {
    inspectedBuildRef.current = undefined;
    inspectedJobRef.current = undefined;
    setPendingBuild(undefined);
    setLastSaveAt(undefined);
  }, [branch, gameId]);

  useEffect(() => {
    const signal = readyBuildSignal(jobs.data?.jobs ?? [], jobBranch);
    if (signal === undefined || signal === inspectedJobRef.current || activeSnapshot === undefined || gameId === '') {
      return;
    }
    inspectedJobRef.current = signal;
    let active = true;
    void getDesignSnapshot(gameId, branch)
      .then(async (next) => {
        if (!active || next.buildId === activeSnapshot.buildId || inspectedBuildRef.current === next.buildId) return;
        inspectedBuildRef.current = next.buildId;
        const change = await inspectBuildChange(activeSnapshot, next, () =>
          getOptionalReapply(gameId, branch, activeSnapshot.buildId, next.buildId),
        );
        if (!active) return;
        if (change.kind === 'switch') {
          setAdopted({ gameId, branch, snapshot: change.snapshot });
        } else if (change.kind === 'review') {
          setPendingBuild({ snapshot: change.snapshot, report: change.report });
        }
      })
      .catch(() => {
        inspectedJobRef.current = undefined;
        inspectedBuildRef.current = undefined;
      });
    return () => {
      active = false;
    };
  }, [activeSnapshot, branch, gameId, jobBranch, jobs.data?.jobs]);

  useEffect(() => {
    const container = containerRef.current;
    const snapshot = activeSnapshot;
    if (container === null || snapshot === undefined || gameId === '') return;
    if (waitingForPreview) return;
    if (waitingForStage) return;
    if (waitingForScenery) return;
    if (activePreview && !previewDesign.data) return;
    if (snapshot.buildId === NO_BUILD_ID && !activePreview && !activeStage && previewSource === undefined) {
      if (previewSourceError) setFrameState({ bridgeState: 'error', dropped: 0 });
      return;
    }
    setFrameState(initialFrameState);
    let controller: GameFrameController;
    try {
      controller = activeStage
        ? mountStagePreview(container, activeStage, setFrameState)
        : snapshot.buildId === NO_BUILD_ID && !activePreview
          ? mountSceneryPreview(container, previewSource!, snapshot.doc, setFrameState)
          : mountGameFrame({
              container,
              gamesOrigin,
              gameId,
              buildId: activePreview?.accessId ?? snapshot.buildId,
              ...(activePreview ? { preview: true } : {}),
              mode,
              design: activePreview ? previewDesign.data! : snapshot,
              build,
              onState: setFrameState,
              onSaveWrite: () => setLastSaveAt(new Date().toISOString()),
              onRoomMessage: room.handleGameMessage,
              onLoadDone: (measurement) => reportGameLoad(measurement, 'ok'),
              onLoadStalled: (measurement) => reportGameLoad(measurement, 'fail'),
            });
    } catch {
      setFrameState({ bridgeState: 'error', dropped: 0 });
      return;
    }
    frameRef.current = controller;
    setFrameController(controller);
    setWatcherCamera('follow');
    return () => {
      controller.dispose();
      if (frameRef.current === controller) frameRef.current = undefined;
      setFrameController((current) => (current === controller ? undefined : current));
    };
  }, [
    activeSnapshot,
    branch,
    build,
    frameAttempt,
    gameId,
    gamesOrigin,
    reportGameLoad,
    room.handleGameMessage,
    previewSource,
    previewSourceError,
    waitingForPreview,
    waitingForStage,
    waitingForScenery,
    activeStage,
    activePreview?.buildId,
    activePreview?.accessId,
    previewDesign.data,
  ]);

  useEffect(() => {
    frameRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'edit' || room.snapshot?.role !== 'peer' || room.snapshot.phase !== 'editing') return;
    frameController?.camera(watcherCamera);
  }, [frameController, mode, room.snapshot?.phase, room.snapshot?.role, watcherCamera]);

  const { sessionStore, sessionView, editStartup } = useEditorSession({
    gameId,
    branch,
    mode,
    role: room.snapshot?.role,
    activeSnapshot,
    requestOnlySnapshot,
    previewOnly: sidePreview,
    source: previewSource,
    frameRef,
    setAdopted,
  });

  const testState: GameTestState = {
    bridgeState: frameState.bridgeState,
    headRev: room.snapshot?.lastRev ?? sessionView?.headRev ?? activeSnapshot?.rev ?? 0,
    lastSaveAt,
    saved: sessionView?.saved ?? 'saved',
    mode,
    selection: sessionView?.selection ?? [],
    dropped: frameState.dropped,
    readOnly: sessionView?.readOnly ?? false,
  };
  const testStateRef = useRef(testState);
  testStateRef.current = testState;
  useEffect(() => {
    if (!searchParams.has('test') || window.__ogmHost === undefined) return;
    const host = window.__ogmHost as TestHost;
    Object.defineProperty(host, 'game', { configurable: true, get: () => testStateRef.current });
    return () => {
      delete host.game;
    };
  }, [searchParams]);

  const setMode = useCallback(
    (nextMode: 'play' | 'edit') => {
      if (mode === nextMode) return;
      const next = new URLSearchParams(searchParams);
      next.set('mode', nextMode);
      setSearchParams(next, { replace: true });
    },
    [mode, searchParams, setSearchParams],
  );
  const requestMode = useCallback(
    (nextMode: 'play' | 'edit') => {
      if (room.snapshot?.role === 'peer') return;
      if (room.snapshot?.role === 'host') {
        room.session?.send({ t: 'phase', to: nextMode === 'play' ? 'playing' : 'editing' });
      }
      setMode(nextMode);
    },
    [room.session, room.snapshot?.role, setMode],
  );
  const leaveRoom = useCallback(async () => {
    try {
      await room.session?.leave();
    } catch {
      pushToast('Could not close room cleanly');
    } finally {
      clearRoomGrant();
      frameRef.current?.dispose();
      void navigate('/all');
    }
  }, [navigate, room.session]);
  const activateRoom = useCallback(
    (created: Parameters<typeof storeRoomGrant>[0]) => {
      storeRoomGrant(created);
      const next = new URLSearchParams(searchParams);
      next.set('v', created.pin.branchId);
      next.set('room', created.roomId);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const askForChange = useCallback(() => {
    if (room.snapshot?.role === 'peer') return;
    requestMode('edit');
    useDock.getState().startEdit({ gameId, branchId: jobBranch, title: game.data?.title ?? '' });
  }, [game.data?.title, gameId, jobBranch, requestMode, room.snapshot?.role]);
  const closeMenu = useCallback(() => setMenuOpen(false), [setMenuOpen]);
  const extraProps: GameExtraProps = useMemo(
    () => ({
      gameId,
      branchId: branch,
      buildId: activeSnapshot?.buildId,
      mode,
      onNavigate: closeMenu,
      onRoomCreated: activateRoom,
      onRoomLeave: leaveRoom,
      roomSession: room.session,
      roomSnapshot: room.snapshot,
    }),
    [activeSnapshot?.buildId, activateRoom, branch, closeMenu, gameId, leaveRoom, mode, room.session, room.snapshot],
  );
  const playMenuControls = useMemo(
    () =>
      mode === 'play' || frameState.manifest?.capabilities.includes('scenery')
        ? {
            actions: [
              { id: 'games', label: 'Games', icon: 'games', onSelect: (): void => void leaveRoom() },
              ...(mode === 'play'
                ? [
                    {
                      id: 'edit',
                      label: 'Edit',
                      icon: 'edit',
                      disabled: room.snapshot?.role === 'peer',
                      onSelect: (): void => {
                        void requestMode('edit');
                      },
                    },
                  ]
                : []),
              {
                id: 'ask-change',
                label: 'Ask for a change',
                icon: 'speak',
                disabled: room.snapshot?.role === 'peer',
                onSelect: askForChange,
              },
            ],
            extras: gameExtraElements('topbar', extraProps),
            button: frameState.manifest?.playMenuButton,
          }
        : {
            actions: [
              { id: 'games', label: 'Games', icon: 'games', onSelect: (): void => void leaveRoom() },
              {
                id: 'ask-change',
                label: 'Ask for a change',
                icon: 'speak',
                disabled: room.snapshot?.role === 'peer',
                onSelect: askForChange,
              },
            ],
            extras: gameExtraElements('topbar', extraProps),
          },
    [askForChange, extraProps, frameState.manifest?.playMenuButton, leaveRoom, mode, requestMode, room.snapshot?.role],
  );
  useGameMenuControls(playMenuControls);

  const hudShown =
    mode === 'play' &&
    frameRef.current !== undefined &&
    frameState.manifest !== undefined &&
    activeSnapshot !== undefined;

  return (
    <section
      className={`game-screen is-${mode === 'edit' ? 'editing' : 'playing'}${frameState.manifest?.capabilities.includes('scenery') ? ' is-scenery' : ''}${['not-saved', 'read-only', 'retrying'].includes(editStartup ?? sessionView?.saved ?? '') ? ' is-unsaved' : ''}`}
      aria-label="Play and edit"
    >
      {mode === 'edit' ? (
        <>
          <FocusZone id={EDITOR_FOCUS_ZONES.bar} className="editor-play-zone">
            <button
              className="editor-play-button"
              type="button"
              aria-label="Play"
              disabled={room.snapshot?.role === 'peer'}
              onClick={() => requestMode('play')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 3v18l14-9z" />
              </svg>
            </button>
          </FocusZone>
          <output className="sr" aria-live="polite">
            {savedLabel(editStartup ?? sessionView?.saved)}
          </output>
        </>
      ) : null}
      <div className="game-stage">
        <div className="game-frame" ref={containerRef} />
        {mode === 'play' && frameController !== undefined ? (
          <DiagnosticsOverlay
            enabled={searchParams.get('net') === '1'}
            build={build}
            read={() => frameController.netInfo()}
            room={() => roomFacts(room.snapshot)}
            transport={() => ({ rttMs: room.snapshot?.rttMs })}
          />
        ) : null}
        {game.data !== undefined && activeSnapshot !== undefined && frameState.bridgeState !== 'error' ? (
          <LoadingLayer key={`${activeSnapshot.buildId}-${frameAttempt}`} game={game.data} load={frameState.load} />
        ) : null}
        {mode === 'edit' &&
        frameRef.current !== undefined &&
        editorManifest !== undefined &&
        sessionStore !== undefined &&
        canvasOptions !== undefined ? (
          <GizmoOverlay
            activePrefab={canvasOptions.prefab}
            frame={frameRef.current}
            manifest={editorManifest}
            session={sessionStore}
            snap={canvasOptions.snap}
            onRequestPlacement={requestOnly ? requestFallbackPlacement : undefined}
            onRequestDelete={
              noBuild && !sidePreview
                ? (entity) =>
                    submitEditRequest(
                      editJobRequest(
                        { gameId, branchId: jobBranch },
                        `Remove ${describeRequestedEntity(entity)}.`,
                        'now',
                        `edit:${crypto.randomUUID()}`,
                      ),
                    )
                : undefined
            }
            onRequestTransform={
              noBuild && !sidePreview
                ? (entity, gizmo, target) =>
                    submitEditRequest(
                      editJobRequest(
                        { gameId, branchId: jobBranch },
                        `Change ${describeRequestedEntity(entity)} using ${gizmo}: ${JSON.stringify(target)}.`,
                        'now',
                        `edit:${crypto.randomUUID()}`,
                      ),
                    )
                : undefined
            }
            allowReadOnlyRequests={noBuild}
          />
        ) : null}
        {hudShown &&
        frameRef.current !== undefined &&
        frameState.manifest !== undefined &&
        activeSnapshot !== undefined ? (
          <PlatformHud
            build={build}
            frame={frameRef.current}
            gameId={gameId}
            paused={menuOpen && roomId === undefined}
            saveContext={{ branch, buildId: activeSnapshot.buildId }}
            saves={frameState.manifest.saves}
            saveSchema={frameState.manifest.saveSchema}
            migratesFrom={frameState.manifest.migratesFrom}
            onLeave={() => void leaveRoom()}
            onResume={() => setMenuOpen(false)}
          />
        ) : null}
        <GameExtras placement="hud" {...extraProps} />
        {activeSnapshot ? (
          <UpdateIndicator
            key={gameId}
            currentBuildId={activeSnapshot.buildId}
            gameId={gameId}
            onPublishedBuild={setPublishedBuildId}
            onError={reportUpdateFailure}
            onUpdate={() => window.location.reload()}
          />
        ) : null}
        <GameExtras placement="overlay" {...extraProps} />
        <RoomLayer
          gameTitle={game.data?.title ?? ''}
          lastSaveAt={lastSaveAt}
          camera={watcherCamera}
          onCamera={(cameraMode) => {
            setWatcherCamera(cameraMode);
          }}
          onLeave={() => void leaveRoom()}
          onMode={setMode}
          onSelection={(ids) => frameRef.current?.select(ids)}
          snapshot={room.snapshot}
        />
      </div>
      {mode === 'edit' && editorManifest !== undefined && sessionView !== undefined && sessionStore !== undefined ? (
        <EditorChrome
          gameId={gameId}
          manifest={editorManifest}
          sceneryAssets={scenerySource.data?.assets}
          session={sessionView}
          onRequestLight={noBuild && !sidePreview ? requestLight : undefined}
          onCommand={(command) => {
            if (noBuild && !sidePreview) {
              submitEditRequest(
                editJobRequest(
                  { gameId, branchId: jobBranch },
                  `Apply this editor change: ${JSON.stringify(command)}.`,
                  'now',
                  `edit:${crypto.randomUUID()}`,
                ),
              );
              return;
            }
            const state = sessionStore.getState();
            void state.submit(
              createIntent(state.doc, [command], command.op === 'invoke' ? command.command : command.control),
            );
          }}
          onTool={(tool) => sessionStore.getState().setTool(tool)}
          onUndo={() => void sessionStore.getState().undo()}
          onRedo={() => void sessionStore.getState().redo()}
          onDelete={(entityId) => {
            const state = sessionStore.getState();
            if (noBuild && !sidePreview) {
              submitEditRequest(
                editJobRequest(
                  { gameId, branchId: jobBranch },
                  `Remove ${describeRequestedEntity(state.doc.entities[entityId], entityId)}.`,
                  'now',
                  `edit:${crypto.randomUUID()}`,
                ),
              );
              return;
            }
            void state.submit(
              deleteEntityIntent(state.doc, entityId, `Removed ${state.doc.entities[entityId]?.prefab}`),
            );
          }}
          onDuplicate={(entityId) => {
            const state = sessionStore.getState();
            const source = state.doc.entities[entityId];
            if (source === undefined) return;
            if (noBuild && !sidePreview) {
              submitEditRequest(
                editJobRequest(
                  { gameId, branchId: jobBranch },
                  `Copy ${describeRequestedEntity(source)}.`,
                  'now',
                  `edit:${crypto.randomUUID()}`,
                ),
              );
              return;
            }
            const entity: Entity = { ...structuredClone(source), id: createStableId('e_'), origin: 'creator' };
            void state.submit(createEntityIntent(state.doc, entity, `Copied ${source.prefab}`));
          }}
          onInstanceCount={(change) => {
            if (noBuild && !sidePreview) {
              submitEditRequest(
                editJobRequest(
                  { gameId, branchId: jobBranch },
                  `${change.direction > 0 ? 'Add' : 'Remove'} one ${JSON.stringify(change.prefab)} instance.`,
                  'now',
                  `edit:${crypto.randomUUID()}`,
                ),
              );
              return Promise.resolve({ ok: true });
            }
            return changeInstanceCount(change, frameState.manifest!, frameRef.current!, sessionStore);
          }}
          onCanvasChange={setCanvasOptions}
        />
      ) : null}
      {frameState.bridgeState === 'error' ? (
        <div className="screen-error" role="alert">
          <button
            className="tap-primary"
            type="button"
            onClick={() => {
              if (activeSnapshot?.buildId === NO_BUILD_ID) void scenerySource.refetch();
              setFrameAttempt((attempt) => attempt + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : null}
      {pendingBuild ? (
        <ReapplyCard
          report={pendingBuild.report}
          onConfirm={(choices) => {
            void submitReapply(gameId, branch, choices)
              .then(() => {
                setAdopted({ gameId, branch, snapshot: pendingBuild.snapshot });
                setPendingBuild(undefined);
              })
              .catch(() => pushToast('Update failed'));
          }}
        />
      ) : null}
      <Outlet />
    </section>
  );
}

function describeRequestedEntity(entity: Entity | undefined, fallbackId?: string): string {
  return JSON.stringify({
    id: entity?.id ?? fallbackId,
    prefab: entity?.prefab,
    sceneryItemId: entity?.props.sceneryItemId,
  });
}

function savedLabel(saved: EditorSessionState['saved'] | undefined): string {
  switch (saved) {
    case 'saving':
      return 'Saving…';
    case 'retrying':
      return 'Not saved, retrying…';
    case 'not-saved':
      return 'Not saved';
    case 'read-only':
      return 'Read only';
    default:
      return 'Saved';
  }
}

function reportUpdateFailure(): void {
  pushToast('Update check failed');
}

function GameExtras({ placement, ...props }: GameExtraProps & { placement: 'topbar' | 'hud' | 'overlay' }) {
  return gameExtraElements(placement, props);
}

function gameExtraElements(placement: 'topbar' | 'hud' | 'overlay', props: GameExtraProps) {
  return gameExtras
    .filter((extra) => extra.placement === placement)
    .map(({ id, Component }) => <Component key={id} {...props} />);
}
