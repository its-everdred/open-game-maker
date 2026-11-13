import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams, useSearchParams } from 'react-router';
import type { StoreApi } from 'zustand/vanilla';

import type { Entity, ReapplyReport } from '@ogm/contracts/browser';

import type { OgmHost } from '../../app/testHook';
import { useGameMenu, useGameMenuControls } from '../../app/GameMenu';
import { useDock } from '../../features/build-chat/dock';
import { gameJobsQueryKey } from '../../features/build-chat/jobs';
import {
  acquireLease,
  getDesignSnapshot,
  getGame,
  getScenerySource,
  getOptionalReapply,
  heartbeatLease,
  listJobs,
  postAnalyticsEvent,
  postTransaction,
  releaseLease,
  NO_BUILD_ID,
  submitReapply,
  type DesignSnapshot,
} from '../../features/editor/api';
import { inspectBuildChange, readyBuildSignal } from '../../features/editor/builds';
import { EditorChrome } from '../../features/editor/EditorChrome';
import { GizmoOverlay } from '../../features/editor/GizmoOverlay';
import { changeInstanceCount } from '../../features/editor/instanceCount';
import {
  mountGameFrame,
  type GameFrameController,
  type GameFrameState,
  type GameLoadMeasurement,
} from '../../features/editor/frame';
import { LeaseController } from '../../features/editor/lease';
import { ReapplyCard } from '../../features/editor/ReapplyCard';
import { createEditorSession, type EditorSessionState } from '../../features/editor/session';
import { bootstrapScenery } from '../../features/editor/scenery-bootstrap';
import { mountSceneryPreview } from '../../features/editor/scenery-preview';
import type { SnapPrefs } from '../../features/editor/SnapPrefs';
import { connectTransactionStream } from '../../features/editor/stream';
import {
  createEntityIntent,
  createIntent,
  createStableId,
  deleteEntityIntent,
  toTransactionBody,
} from '../../features/editor/transactions';
import { pushToast } from '../../lib/notify/slice';
import { DiagnosticsOverlay } from '../../net/diagnostics/DiagnosticsOverlay';
import { RoomLayer } from '../../features/room/RoomLayer';
import { useRoomRuntime } from '../../features/room/useRoomRuntime';
import { useBranches } from '../games/useBranches';
import { clearRoomGrant, storeRoomGrant } from '../join/grant-store';
import { PlayEditBar } from './PlayEditBar';
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
  const [sessionStore, setSessionStore] = useState<StoreApi<EditorSessionState>>();
  const [sessionView, setSessionView] = useState<EditorSessionState>();
  const [editStartup, setEditStartup] = useState<EditorSessionState['saved']>();
  const [canvasOptions, setCanvasOptions] = useState<{ prefab?: string; snap: SnapPrefs }>();
  const [adopted, setAdopted] = useState<{ gameId: string; branch: string; snapshot: DesignSnapshot }>();
  const [pendingBuild, setPendingBuild] = useState<{ snapshot: DesignSnapshot; report: ReapplyReport }>();
  const [publishedBuildId, setPublishedBuildId] = useState<string>();
  const [lastSaveAt, setLastSaveAt] = useState<string>();
  /* Outlives the watcher overlay (unmounted while playing); a new frame starts its game on the default follow camera. */
  const [watcherCamera, setWatcherCamera] = useState<'follow' | 'free'>('follow');
  const inspectedBuildRef = useRef<string | undefined>(undefined);
  const inspectedJobRef = useRef<string | undefined>(undefined);
  const activeSnapshot = adopted?.gameId === gameId && adopted.branch === branch ? adopted.snapshot : design.data;
  const scenerySource = useQuery({
    queryKey: ['scenery-source', gameId],
    queryFn: () => getScenerySource(gameId),
    enabled: gameId !== '' && activeSnapshot?.buildId === NO_BUILD_ID,
  });
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
    const signal = readyBuildSignal(jobs.data?.jobs ?? [], branch);
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
  }, [activeSnapshot, branch, gameId, jobs.data?.jobs]);

  useEffect(() => {
    const container = containerRef.current;
    const snapshot = activeSnapshot;
    if (container === null || snapshot === undefined || gameId === '') return;
    if (snapshot.buildId === NO_BUILD_ID && scenerySource.data === undefined) {
      if (scenerySource.isError) setFrameState({ bridgeState: 'error', dropped: 0 });
      return;
    }
    setFrameState(initialFrameState);
    let controller: GameFrameController;
    try {
      controller =
        snapshot.buildId === NO_BUILD_ID
          ? mountSceneryPreview(container, scenerySource.data!, snapshot.doc, setFrameState)
          : mountGameFrame({
              container,
              gamesOrigin,
              gameId,
              buildId: snapshot.buildId,
              mode,
              design: snapshot,
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
    scenerySource.data,
    scenerySource.isError,
  ]);

  useEffect(() => {
    frameRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'edit' || room.snapshot?.role !== 'peer' || room.snapshot.phase !== 'editing') return;
    frameController?.camera(watcherCamera);
  }, [frameController, mode, room.snapshot?.phase, room.snapshot?.role, watcherCamera]);

  useEffect(() => {
    if (
      mode !== 'edit' ||
      room.snapshot?.role === 'peer' ||
      activeSnapshot === undefined ||
      gameId === '' ||
      (activeSnapshot.buildId === NO_BUILD_ID && scenerySource.data === undefined)
    ) {
      setSessionStore(undefined);
      setEditStartup(undefined);
      return;
    }
    setEditStartup('saving');
    const snapshot = activeSnapshot;
    const sessionId = globalThis.crypto.randomUUID();
    let active = true;
    let stream: ReturnType<typeof connectTransactionStream> | undefined;
    let editor: StoreApi<EditorSessionState> | undefined;
    const lease = new LeaseController({
      api: {
        acquire: () => acquireLease(gameId, branch, sessionId),
        heartbeat: (token) => heartbeatLease(gameId, branch, sessionId, token),
        release: (token) => releaseLease(gameId, branch, sessionId, token),
      },
      onLost: (holder) => {
        if (editor === undefined) {
          if (active) setEditStartup('read-only');
        } else {
          void editor.getState().loseLease(holder);
        }
      },
      onError: () => {
        if (!active) return;
        setEditStartup(editor === undefined ? 'not-saved' : 'retrying');
      },
      onRecovered: () => {
        if (active && editor !== undefined) setEditStartup(undefined);
      },
    });

    void lease
      .start()
      .then(async (result) => {
        if (!active) {
          await lease.stop();
          return;
        }
        if (!result.ok) return;
        let initial = snapshot;
        if (snapshot.buildId === NO_BUILD_ID) {
          initial = await getDesignSnapshot(gameId, branch);
          if (initial.buildId !== NO_BUILD_ID) {
            if (active) setAdopted({ gameId, branch, snapshot: initial });
            return;
          }
          const intent = await bootstrapScenery(initial.doc, scenerySource.data!.scene);
          if (intent) {
            const saved = await postTransaction(
              gameId,
              branch,
              toTransactionBody(intent, {
                baseRev: initial.rev,
                leaseToken: result.lease.token,
                baseBuildId: NO_BUILD_ID,
                sessionId,
              }),
            );
            if (!saved.ok) throw new Error('initial scenery could not be saved');
            initial = { ...initial, rev: saved.rev, doc: intent.doc };
          }
        }
        if (!active) return;
        frameRef.current?.applyDesign(initial.rev, initial.doc, []);
        editor = createSession(gameId, branch, sessionId, result.lease.token, initial, frameRef);
        setSessionStore(editor);
        setEditStartup(undefined);
        stream = connectTransactionStream({
          gameId,
          branch,
          after: initial.rev,
          receive: (transaction) => editor?.getState().receive(transaction),
        });
      })
      .catch(() => {
        if (active) setEditStartup('not-saved');
        void lease.stop();
      });

    return () => {
      active = false;
      stream?.close();
      void lease.stop();
      setSessionStore(undefined);
    };
  }, [activeSnapshot, branch, gameId, mode, room.snapshot?.role, scenerySource.data]);

  useEffect(() => {
    if (sessionStore === undefined) {
      setSessionView(undefined);
      return;
    }
    setSessionView(sessionStore.getState());
    return sessionStore.subscribe((state) => setSessionView(state));
  }, [sessionStore]);

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
              { id: 'games', label: 'Games', icon: 'games', onSelect: () => void leaveRoom() },
              ...(mode === 'play'
                ? [
                    {
                      id: 'edit',
                      label: 'Edit',
                      icon: 'edit',
                      disabled: room.snapshot?.role === 'peer',
                      onSelect: () => requestMode('edit'),
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
        : undefined,
    [
      askForChange,
      extraProps,
      frameState.manifest?.playMenuButton,
      frameState.manifest?.capabilities,
      leaveRoom,
      mode,
      requestMode,
      room.snapshot?.role,
    ],
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
        <PlayEditBar
          title={game.data?.title ?? ''}
          mode={mode}
          saved={savedLabel(editStartup ?? sessionView?.saved)}
          build={build}
          playLabel={frameState.manifest?.playLabel}
          onBack={() => void leaveRoom()}
          onMode={requestMode}
          onAsk={askForChange}
        >
          <GameExtras placement="topbar" {...extraProps} />
        </PlayEditBar>
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
        frameState.manifest !== undefined &&
        sessionStore !== undefined &&
        canvasOptions !== undefined ? (
          <GizmoOverlay
            activePrefab={canvasOptions.prefab}
            frame={frameRef.current}
            manifest={frameState.manifest}
            session={sessionStore}
            snap={canvasOptions.snap}
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
      {mode === 'edit' &&
      frameState.manifest !== undefined &&
      sessionView !== undefined &&
      sessionStore !== undefined ? (
        <EditorChrome
          gameId={gameId}
          manifest={frameState.manifest}
          session={sessionView}
          onCommand={(command) => {
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
            void state.submit(
              deleteEntityIntent(state.doc, entityId, `Removed ${state.doc.entities[entityId]?.prefab}`),
            );
          }}
          onDuplicate={(entityId) => {
            const state = sessionStore.getState();
            const source = state.doc.entities[entityId];
            if (source === undefined) return;
            const entity: Entity = { ...structuredClone(source), id: createStableId('e_'), origin: 'creator' };
            void state.submit(createEntityIntent(state.doc, entity, `Copied ${source.prefab}`));
          }}
          onInstanceCount={(change) =>
            changeInstanceCount(change, frameState.manifest!, frameRef.current!, sessionStore)
          }
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

function createSession(
  gameId: string,
  branch: string,
  sessionId: string,
  leaseToken: number,
  snapshot: DesignSnapshot,
  frameRef: React.RefObject<GameFrameController | undefined>,
) {
  return createEditorSession({
    sessionId,
    leaseToken,
    snapshot,
    api: {
      postTransaction: (body) => postTransaction(gameId, branch, body),
      getSnapshot: () => getDesignSnapshot(gameId, branch),
    },
    applyDesign: (doc, patches, rev) => frameRef.current?.applyDesign(rev, doc, patches),
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
