import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useMatch, useNavigate, useParams, useSearchParams } from 'react-router';

import type { CreateJobRequest, Entity, ReapplyReport } from '@ogm/contracts/browser';

import type { OgmHost } from '../../app/testHook';
import { useGameMenu, useGameMenuControls } from '../../app/GameMenu';
import { useDock } from '../../features/build-chat/dock';
import { editJobRequest } from '../../features/build-chat/edit';
import { gameJobsQueryKey, myJobsQueryKey } from '../../features/build-chat/jobs';
import {
  getBuildDesign,
  getDesignSnapshot,
  getGame,
  getFallbackPalette,
  getEditorPreviews,
  getEditorStage,
  getPreviewDesign,
  getScenerySource,
  postAnalyticsEvent,
  NO_BUILD_ID,
  submitReapply,
  type DesignSnapshot,
} from '../../features/editor/api';
import { EditorChrome } from '../../features/editor/EditorChrome';
import { SceneStrip } from '../../features/editor/scenes/SceneStrip';
import { Hd2dPanel } from '../../features/editor/hd2d/Hd2dPanel';
import { fallbackEditRequest, previewEditRequest } from '../../features/editor/fallback-request';
import { GizmoOverlay } from '../../features/editor/GizmoOverlay';
import { changeInstanceCount } from '../../features/editor/instanceCount';
import {
  hidesHostPause,
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
import { annotateGeneratedPalette } from '../../features/editor/palette-generated';
import { starterPalette } from '../../features/editor/starter-palette';
import { containedStagePoint, mountStagePreview } from '../../features/editor/stage-preview';
import { admitJob } from '../../features/scope-chat/admit';
import { energyRefusalText } from '../../features/energy/api';
import type { SnapPrefs } from '../../features/editor/SnapPrefs';
import {
  createEntityIntent,
  copyEntity,
  createIntent,
  createStableId,
  deleteEntityIntent,
} from '../../features/editor/transactions';
import { api } from '../../lib/api/client';
import { pushToast } from '../../lib/notify/slice';
import { DiagnosticsOverlay } from '../../net/diagnostics/DiagnosticsOverlay';
import { RoomLayer } from '../../features/room/RoomLayer';
import { useRoomRuntime } from '../../features/room/useRoomRuntime';
import { useBranches } from '../games/useBranches';
import type { GameSummary } from '../games/types';
import { clearRoomGrant, storeRoomGrant } from '../join/grant-store';
import { LoadingLayer } from './LoadingLayer';
import { EditPlayBar, GameEditWorkspace } from './EditWorkspace';
import { useEditConversation } from './useEditConversation';
import { gameLoadActivity } from './load-analytics';
import { readAway, useAwayPause, useEarlyAwayHold } from './away-pause';
import { PlatformHud } from './PlatformHud';
import { roomFacts } from './room-facts';
import { recordPlay } from './recordPlay';
import { saveOptions } from './startup-save';
import { useReadyBuild } from './use-ready-build';
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
  /** The scenarios the running build declares (#1281); `gm look shell --scenario` checks its name against them. */
  scenarios: readonly string[];
};

type TestHost = OgmHost & { game?: GameTestState };

export function GameScreen() {
  const queryClient = useQueryClient();
  const { gameId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { open: menuOpen, setOpen: setMenuOpen, setMoreHost, setCloseLocked } = useGameMenu();
  const branch = searchParams.get('v')?.trim() || 'main';
  const roomId = searchParams.get('room')?.trim() || undefined;
  const scenario = searchParams.get('scenario');
  /* A link to one build (a review's "Play this build") names it here; the frame plays it instead of the branch head. */
  const linkedBuild = searchParams.get('build')?.trim() || undefined;
  const isGameRoute = useMatch('/g/:gameId') !== null;
  const mode: 'play' | 'edit' = searchParams.get('mode') === 'edit' ? 'edit' : 'play';
  const gamesOrigin = import.meta.env.VITE_GAMES_ORIGIN ?? 'http://127.0.0.1:10000';
  const game = useQuery({ queryKey: ['game', gameId], queryFn: () => getGame(gameId), enabled: gameId !== '' });
  const loadedGameId = game.data?.id;
  /* The games list already holds this game's art, so the loading screen never waits on the game request. */
  const listedGame = useMemo(
    () =>
      queryClient
        .getQueriesData<GameSummary[]>({ queryKey: ['games'] })
        .flatMap(([, games]) => games ?? [])
        .find((item) => item.id === gameId),
    [queryClient, gameId],
  );
  useEffect(() => {
    if (!isGameRoute || mode !== 'play' || loadedGameId !== gameId || !gameId) return;
    const controller = new AbortController();
    void recordPlay(gameId, controller.signal)
      .then(() => queryClient.invalidateQueries({ queryKey: ['games'] }))
      .catch(() => {});
    return () => controller.abort();
  }, [gameId, isGameRoute, loadedGameId, mode, queryClient]);
  const design = useQuery({
    queryKey: ['design', gameId, branch],
    queryFn: () => getDesignSnapshot(gameId, branch),
    enabled: gameId !== '',
  });
  const branches = useBranches(gameId === '' ? null : gameId);
  // Games open with the branch id in `v`; job admission only takes the canonical name of the main branch.
  const jobBranch = branches.data?.find(({ id }) => id === branch)?.name === 'main' ? 'main' : branch;
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<GameFrameController | undefined>(undefined);
  const awayHold = useRef(false);
  useEarlyAwayHold(mode === 'play' && roomId === undefined, gameId, awayHold, () => setMenuOpen(true));
  const [frameController, setFrameController] = useState<GameFrameController>();
  const [frameState, setFrameState] = useState(initialFrameState);
  const [frameAttempt, setFrameAttempt] = useState(0);
  const skipRestore = useRef(false);
  const menuOpenRef = useRef(menuOpen);
  const roomIdRef = useRef(roomId);
  menuOpenRef.current = menuOpen;
  roomIdRef.current = roomId;
  const [canvasOptions, setCanvasOptions] = useState<{ prefab?: string; snap: SnapPrefs }>();
  const [editorPlaying, setEditorPlaying] = useState(true);
  const { jobs, ...conversation } = useEditConversation(gameId, jobBranch);
  useEffect(() => setEditorPlaying(true), [gameId, mode]);
  const fallbackInFlight = useRef(false);
  const [adopted, setAdopted] = useState<{ gameId: string; branch: string; snapshot: DesignSnapshot }>();
  const [pendingBuild, setPendingBuild] = useState<{ snapshot: DesignSnapshot; report: ReapplyReport }>();
  const [publishedBuildId, setPublishedBuildId] = useState<string>();
  const [lastSaveAt, setLastSaveAt] = useState<string>();
  /* Outlives the watcher overlay (unmounted while playing); a new frame starts its game on the default follow camera. */
  const [watcherCamera, setWatcherCamera] = useState<'follow' | 'free'>('follow');
  const activeSnapshot = adopted?.gameId === gameId && adopted.branch === branch ? adopted.snapshot : design.data;
  const noBuild = activeSnapshot?.buildId === NO_BUILD_ID;
  const designLoadFailed = design.isError && activeSnapshot === undefined;
  const otherBuild =
    linkedBuild !== undefined && activeSnapshot !== undefined && linkedBuild !== activeSnapshot.buildId;
  const linkedDesign = useQuery({
    queryKey: ['build-design', gameId, linkedBuild],
    queryFn: () => getBuildDesign(gameId, linkedBuild!),
    enabled: gameId !== '' && otherBuild,
    retry: false,
  });
  const linkedSnapshot = otherBuild ? linkedDesign.data : undefined;
  /* The build the frame runs: saves, away state, extras and thumbnails belong to it, not to the branch head. */
  const runningBuildId = linkedSnapshot?.buildId ?? activeSnapshot?.buildId;
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
  useLayoutEffect(
    () => setFrameState(initialFrameState),
    [gameId, branch, activeSnapshot, linkedSnapshot, activePreview?.accessId, frameAttempt],
  );
  const stage = useQuery({
    queryKey: ['editor-stage', gameId, jobBranch],
    queryFn: () => getEditorStage(gameId, jobBranch),
    enabled: gameId !== '' && noBuild && !waitingForPreview && !activePreview,
    refetchInterval: 60_000,
    retry: false,
  });
  const waitingForStage = noBuild && !waitingForPreview && !activePreview && stage.isPending;
  const hasPaletteAssetIds = !!frameState.manifest?.palette?.items.some((item) => typeof item.assetId === 'string');
  const hasSceneryPrefabs = !!frameState.manifest?.palette?.items.some((item) => item.prefab.startsWith('scenery:'));
  const paletteBuildId =
    hasPaletteAssetIds || hasSceneryPrefabs
      ? (activePreview?.buildId ?? (!noBuild ? activeSnapshot?.buildId : undefined))
      : undefined;
  const scenerySource = useQuery({
    queryKey: ['scenery-source', gameId, jobBranch, paletteBuildId],
    queryFn: () =>
      paletteBuildId ? getScenerySource(gameId, jobBranch, paletteBuildId) : getScenerySource(gameId, jobBranch),
    enabled:
      gameId !== '' &&
      ((noBuild && !waitingForPreview && !waitingForStage && !activePreview) ||
        (mode === 'edit' && (!!frameState.manifest?.capabilities.includes('scenery') || hasPaletteAssetIds))),
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
  const nativePaletteEmpty = nativePalette !== undefined && nativePalette.items.length === 0;
  const fallback = useQuery({
    queryKey: ['editor-fallback', gameId],
    queryFn: () => getFallbackPalette(gameId),
    enabled: gameId !== '' && mode === 'edit' && nativePalette !== undefined,
    retry: false,
  });
  const fallbackActive = nativePaletteEmpty && fallback.isSuccess;
  const fallbackPalette = useMemo(() => {
    const base = fallback.data?.palette.items.length ? fallback.data.palette : starterPalette;
    const panels = (nativePalette?.categories ?? []).filter(
      (category) => category.kind === 'panel' && !base.categories.some((candidate) => candidate.id === category.id),
    );
    return panels.length ? { ...base, categories: [...base.categories, ...panels] } : base;
  }, [fallback.data, nativePalette]);
  const sideBranch =
    branches.data?.some(({ id, name }) => (id === branch || name === branch) && name !== 'main') === true;
  const sidePreview = noBuild && sideBranch && !fallbackActive && !activeStage;
  const requestOnly = fallbackActive || (noBuild && !sidePreview);
  const editorManifest = useMemo(() => {
    if (!frameState.manifest) return undefined;
    const native = frameState.manifest;
    const manifest = fallbackActive
      ? { ...native, palette: fallbackPalette }
      : native.palette
        ? { ...native, palette: annotateGeneratedPalette(native.palette, fallback.data?.palette) }
        : native;
    const buildId = activePreview?.accessId ?? runningBuildId;
    if (mode !== 'edit' || fallbackActive || !buildId || (noBuild && !activePreview)) return manifest;
    return resolvePaletteThumbnails(manifest, gamesOrigin, gameId, buildId, !!activePreview);
  }, [
    frameState.manifest,
    fallbackActive,
    fallbackPalette,
    fallback.data,
    activePreview,
    runningBuildId,
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
      const palette = fallbackActive ? fallbackPalette : frameState.manifest?.palette;
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
          fallbackActive && !prefab.startsWith('scope:') && !prefab.startsWith('scenery-band:')
            ? fallbackEditRequest(target, { assetId: prefab, name: item.label, ...point }, key)
            : previewEditRequest(target, { prefab, name: item.label, ...point }, key);
        submitEditRequest(request);
      } catch {
        pushToast('The build could not be started.');
      }
    },
    [activeStage, fallbackPalette, fallbackActive, frameState.manifest, gameId, jobBranch, submitEditRequest],
  );
  const build = publishedBuildId !== undefined && publishedBuildId === runningBuildId ? 'published' : 'draft';
  const room = useRoomRuntime({ frame: frameController, roomId, testMode: searchParams.has('test') });
  const pauseRequested = useRef(false);
  const wasMatchPaused = useRef(false);
  useEffect(() => {
    const paused = room.snapshot?.matchPause !== undefined;
    if (wasMatchPaused.current && !paused) setMenuOpen(false);
    wasMatchPaused.current = paused;
  }, [room.snapshot?.matchPause, setMenuOpen]);
  useEffect(() => {
    if (!menuOpen) {
      pauseRequested.current = false;
      return;
    }
    if (!pauseRequested.current && roomId !== undefined && room.session && room.snapshot?.status === 'connected') {
      room.session.send({ t: 'match.pause.request' });
      pauseRequested.current = true;
    }
  }, [menuOpen, room.session, room.snapshot?.status, roomId]);
  const reportGameLoad = useCallback(
    (measurement: GameLoadMeasurement, result: 'ok' | 'fail') => {
      void postAnalyticsEvent(gameLoadActivity(gameId, measurement, result)).catch(() => undefined);
    },
    [gameId],
  );

  useEffect(() => {
    setPendingBuild(undefined);
    setLastSaveAt(undefined);
  }, [branch, gameId]);

  useReadyBuild({ gameId, branch, jobBranch, activeSnapshot, jobs: jobs.data?.jobs, setAdopted, setPendingBuild });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || activeSnapshot === undefined || gameId === '') return;
    if (otherBuild && linkedDesign.isError) {
      setFrameState({ bridgeState: 'error', dropped: 0 });
      return;
    }
    if (otherBuild && linkedSnapshot === undefined) return;
    const snapshot = linkedSnapshot ?? activeSnapshot;
    /* A linked build plays as it was built: no request-only preview, stage or scenery stands in for it. */
    const framePreview = linkedSnapshot ? undefined : activePreview;
    const frameStage = linkedSnapshot ? undefined : activeStage;
    if (!linkedSnapshot) {
      if (waitingForPreview) return;
      if (waitingForStage) return;
      if (waitingForScenery) return;
      if (framePreview && !previewDesign.data) return;
      if (snapshot.buildId === NO_BUILD_ID && !framePreview && !frameStage && previewSource === undefined) {
        if (previewSourceError) setFrameState({ bridgeState: 'error', dropped: 0 });
        return;
      }
    }
    setFrameState(initialFrameState);
    const restoreOnStart = mode === 'play' && roomId === undefined && !framePreview && !skipRestore.current;
    const away = restoreOnStart ? readAway(gameId, snapshot.buildId) : undefined;
    if (away) {
      awayHold.current = true;
      setMenuOpen(true);
    }
    skipRestore.current = false;
    let controller: GameFrameController;
    try {
      controller = frameStage
        ? mountStagePreview(container, frameStage, setFrameState)
        : snapshot.buildId === NO_BUILD_ID && !framePreview
          ? mountSceneryPreview(container, previewSource!, snapshot.doc, setFrameState)
          : mountGameFrame({
              container,
              gamesOrigin,
              gameId,
              buildId: framePreview?.accessId ?? snapshot.buildId,
              ...(framePreview ? { preview: true } : {}),
              mode: mode === 'edit' ? 'play' : mode,
              ...(scenario === null ? {} : { params: { scenario } }),
              ...(restoreOnStart ? saveOptions(gameId, roomIdRef, menuOpenRef, away, awayHold) : {}),
              design: framePreview ? previewDesign.data! : snapshot,
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
    scenario,
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
    otherBuild,
    linkedDesign.isError,
    linkedSnapshot,
  ]);

  useEffect(() => {
    frameController?.setMode(mode === 'edit' && editorPlaying ? 'play' : mode);
  }, [frameController, mode, editorPlaying]);

  useEffect(() => {
    if (mode !== 'edit' || room.snapshot?.role !== 'peer' || room.snapshot.phase !== 'editing') return;
    frameController?.camera(watcherCamera);
  }, [frameController, mode, room.snapshot?.phase, room.snapshot?.role, watcherCamera]);

  const { sessionStore, sessionView, editStartup } = useEditorSession({
    gameId,
    branch,
    mode,
    role: room.snapshot?.role,
    /* A linked build is shown read-only: no branch lease, so the head design never replaces it in the frame. */
    activeSnapshot: otherBuild ? undefined : activeSnapshot,
    requestOnlySnapshot: otherBuild ? linkedSnapshot : requestOnlySnapshot,
    previewOnly: otherBuild ? false : sidePreview,
    source: otherBuild ? undefined : previewSource,
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
    scenarios: frameState.manifest?.scenarios ?? [],
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
      buildId: runningBuildId,
      mode,
      authorityMode: frameState.manifest?.net?.authority,
      onNavigate: closeMenu,
      onRoomCreated: activateRoom,
      onRoomLeave: leaveRoom,
      roomSession: room.session,
      roomSnapshot: room.snapshot,
    }),
    [
      runningBuildId,
      activateRoom,
      branch,
      closeMenu,
      frameState.manifest?.net?.authority,
      gameId,
      leaveRoom,
      mode,
      room.session,
      room.snapshot,
    ],
  );
  const preference = useMutation({
    mutationFn: (allow: boolean) =>
      api(`/games/${encodeURIComponent(gameId)}`, {
        method: 'PATCH',
        json: { allowAiGeneratedAssets: allow },
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['game', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['games'] }),
      ]),
    onError: () => pushToast('Could not update AI asset setting'),
  });
  const preferenceAction = useMemo(
    () =>
      mode === 'edit' && game.data
        ? [
            {
              id: 'ai-assets',
              label: game.data.allowAiGeneratedAssets ? 'Disable AI-generated assets' : 'Enable AI-generated assets',
              icon: 'other',
              disabled: preference.isPending,
              onSelect: () => preference.mutate(!game.data!.allowAiGeneratedAssets),
            },
          ]
        : [],
    [mode, game.data, preference.isPending, preference.mutate],
  );
  const playMenuControls = useMemo(
    () =>
      mode === 'play' || frameState.manifest?.capabilities.includes('scenery')
        ? {
            actions: [
              {
                id: 'games',
                label: 'Games',
                icon: 'games',
                onPausePanel: true,
                onSelect: (): void => void leaveRoom(),
              },
              ...preferenceAction,
              ...(mode === 'play'
                ? [
                    {
                      id: 'edit',
                      label: 'Edit',
                      icon: 'edit',
                      onPausePanel: true,
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
            hideButton: hidesHostPause(mode, frameState),
          }
        : {
            actions: [
              { id: 'games', label: 'Games', icon: 'games', onSelect: (): void => void leaveRoom() },
              ...preferenceAction,
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
    [
      askForChange,
      extraProps,
      frameState.bridgeState,
      frameState.hostPauseVisible,
      leaveRoom,
      mode,
      requestMode,
      room.snapshot?.role,
      preferenceAction,
    ],
  );
  useGameMenuControls(playMenuControls);

  const hudShown =
    mode === 'play' &&
    frameRef.current !== undefined &&
    frameState.manifest !== undefined &&
    activeSnapshot !== undefined;
  const { onSavePersisted: onAwaySavePersisted, resetAway } = useAwayPause({
    frame: mode === 'play' ? frameController : undefined,
    gameId,
    buildId: runningBuildId,
    solo: roomId === undefined,
    captureSaves: hudShown,
    menuOpen,
    openMenu: () => {
      awayHold.current = true;
      setMenuOpen(true);
    },
    releaseHold: () => {
      awayHold.current = false;
    },
  });

  const gameStage = (
    <div className="game-stage-area" data-edit-frame={mode === 'edit' ? '' : undefined}>
      {mode === 'edit' && (
        <SceneStrip gameId={gameId} build={runningBuildId} scenarios={frameState.manifest?.scenarios} />
      )}
      {mode === 'edit' && !editorPlaying && <Hd2dPanel report={frameState.hd2d} apply={frameController?.applyHd2d} />}
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
        {!designLoadFailed &&
        (!noBuild || activePreview !== undefined || linkedSnapshot !== undefined) &&
        frameState.bridgeState !== 'error' ? (
          <LoadingLayer
            key={`${linkedSnapshot?.buildId ?? activePreview?.accessId ?? activeSnapshot?.buildId ?? 'pending'}-${frameAttempt}`}
            game={game.data ?? listedGame ?? { familyId: '', title: '' }}
            load={frameState.load}
            firstFrame={frameState.firstFrame}
          />
        ) : null}
        {mode === 'edit' &&
        !editorPlaying &&
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
            onRequestPlacement={
              requestOnly && (noBuild || canvasOptions.prefab !== undefined) ? requestFallbackPlacement : undefined
            }
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
            key={`platform-hud-${gameId}`}
            build={build}
            frame={frameRef.current}
            gameId={gameId}
            actions={frameState.manifest.inputs.actions}
            controlBindings={frameState.manifest.controlBindings}
            controlReservedKeys={frameState.manifest.controlReservedKeys}
            gameOptions={frameState.manifest.gameOptions}
            open={menuOpen || room.snapshot?.matchPause !== undefined}
            paused={roomId === undefined ? menuOpen : room.snapshot?.matchPause !== undefined}
            pauseName={room.snapshot?.matchPause?.name}
            resumeAt={room.snapshot?.matchPause?.resumeAt}
            serverOffsetMs={room.snapshot?.serverOffsetMs}
            saveContext={{ branch, buildId: runningBuildId ?? activeSnapshot.buildId }}
            saves={frameState.manifest.saves}
            saveWritesDisabled={frameState.startupSaveError}
            manualLoadDisabled={frameState.startupRecoveryUnavailable}
            setCloseLocked={setCloseLocked}
            onSavePersisted={onAwaySavePersisted}
            manualSaveSlots={frameState.manifest.manualSaveSlots}
            saveSchema={frameState.manifest.saveSchema}
            migratesFrom={frameState.manifest.migratesFrom}
            onLeave={() => void leaveRoom()}
            onRestart={
              roomId === undefined
                ? () => {
                    setMenuOpen(false);
                    resetAway();
                    skipRestore.current = true;
                    setFrameAttempt((attempt) => attempt + 1);
                  }
                : undefined
            }
            onEdit={() => {
              setMenuOpen(false);
              void requestMode('edit');
            }}
            editDisabled={room.snapshot?.role === 'peer'}
            onMoreHost={setMoreHost}
            onResume={() => {
              if (roomId !== undefined && room.snapshot?.matchPause) room.session?.send({ t: 'match.resume.request' });
              setMenuOpen(false);
            }}
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
    </div>
  );
  const declaredControls = (frameState.manifest as typeof frameState.manifest & { controls?: unknown[] })?.controls;
  const hasEditor =
    noBuild ||
    !!frameState.manifest?.palette?.items.length ||
    !!frameState.manifest?.palette?.categories.length ||
    !!frameState.manifest?.tools?.length ||
    !!declaredControls?.length;
  const editorChrome =
    mode === 'edit' &&
    hasEditor &&
    editorManifest !== undefined &&
    sessionView !== undefined &&
    sessionStore !== undefined ? (
      <EditorChrome
        gameId={gameId}
        manifest={editorManifest}
        sceneryAssets={scenerySource.data?.assets}
        buildPinnedAssets={!!paletteBuildId && !activePreview && !!scenerySource.data}
        session={sessionView}
        onSelection={(ids) => frameRef.current?.select(ids)}
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
        onTool={(tool) => {
          setEditorPlaying(false);
          sessionStore.getState().setTool(tool);
          document.querySelector<HTMLDetailsElement>('.edit-workspace-editor')?.removeAttribute('open');
        }}
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
          void state.submit(deleteEntityIntent(state.doc, entityId, `Removed ${state.doc.entities[entityId]?.prefab}`));
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
          const entity = copyEntity(source, createStableId('e_'));
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
    ) : null;

  return (
    <section
      className={`game-screen is-${mode === 'edit' ? 'editing' : 'playing'}${frameState.manifest?.capabilities.includes('scenery') ? ' is-scenery' : ''}${['not-saved', 'read-only', 'retrying'].includes(editStartup ?? sessionView?.saved ?? '') ? ' is-unsaved' : ''}`}
      aria-label="Play and edit"
    >
      {mode === 'edit' ? (
        <EditPlayBar
          disabled={room.snapshot?.role === 'peer'}
          onPlay={() => (editorPlaying ? requestMode('play') : setEditorPlaying(true))}
          saved={savedLabel(editStartup ?? sessionView?.saved)}
        />
      ) : null}
      <GameEditWorkspace
        editing={mode === 'edit'}
        game={gameStage}
        conversation={{
          gameId,
          branchId: jobBranch,
          title: game.data?.title ?? '',
          ...conversation,
          reading: searchParams.get('composer') === 'stacked' ? 'stacked' : 'inline',
        }}
        editor={editorChrome}
      />
      {frameState.bridgeState === 'error' || designLoadFailed ? (
        <div className="screen-error" role="alert">
          <button
            className="tap-primary"
            type="button"
            onClick={() => {
              if (designLoadFailed) void design.refetch();
              if (activeSnapshot?.buildId === NO_BUILD_ID) void scenerySource.refetch();
              if (linkedDesign.isError) void linkedDesign.refetch();
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
