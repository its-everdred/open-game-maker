import { SDK_PROTOCOL, hostToGameSchema, type Envelope, type HostToGame } from '@ogm/contracts/bridge';
import type { GameInstance, GameManifest, GameModule, PlayerSettings, SaveData, Viewport } from '@ogm/contracts/game';
import type { ActionFrame } from '@ogm/contracts/input';
import { openGameBridge } from '@ogm/iframe-bridge';

import { EventRing } from './events.js';
import { installFaultRelay } from './faults.js';
import { linkedHd2d, watchHd2d } from './hd2d-link.js';
import { SdkHostApi, type SendEnvelope } from './host-api.js';
import { RuntimeImpl, type BuildKind, type Runtime } from './runtime.js';
import { GM_PAUSED_FLAG, GM_PAUSE_EVENT } from '../audio/unlock.js';
import { deliverMenuFrame, setMenuActionKinds } from '../menu/host-frames.js';
import { createNetController } from '../net/index.js';
import { createSaveMachine, type SaveMachine } from '../saves/machine.js';
import { createSaveThumbnailCache } from '../saves/thumbnail.js';
import { installQa } from './qa.js';
import { declaredScenarios, startScenario } from './scenarios.js';
import { dispatchTest } from '../test/dispatch.js';
import { SdkHooks } from '../test/hooks.js';

declare const __GM_BUILD__: BuildKind | undefined;

export interface BootOptions {
  hostOrigin?: string;
  build?: BuildKind;
  headless?: boolean;
}

function canonicalOrigin(origin: string): string {
  return new URL(origin).origin;
}

function originFromDocument(): string {
  if (!document.referrer) throw new Error('boot requires hostOrigin when document.referrer is empty');
  return canonicalOrigin(document.referrer);
}

/** Tells the game's audio that the host paused or resumed play, so it stays quiet until the player resumes. */
function announcePause(paused: boolean): void {
  if (typeof window === 'undefined') return;
  Reflect.set(window, GM_PAUSED_FLAG, paused);
  window.dispatchEvent(new CustomEvent(GM_PAUSE_EVENT, { detail: { paused } }));
}

function markNow(): number {
  return performance.now();
}

function compiledBuild(): BuildKind {
  return typeof __GM_BUILD__ === 'undefined' ? 'draft' : __GM_BUILD__;
}

/**
 * The manifest a build reports once mounted: the game's own manifest plus the save facts the host needs to judge a
 * stored slot before it offers Load. Both come from the running instance, so a static `manifest.json` cannot drift
 * from the code that actually writes saves — and a build without a `migrate` hook cannot claim a migration it lacks.
 */
function readyManifest<D, S>(
  module: GameModule<D, S>,
  instance: GameInstance<D, S>,
  inScenario: boolean,
): GameManifest {
  const names = declaredScenarios(module);
  const manifest: GameManifest = names.length ? { ...module.manifest, scenarios: names } : module.manifest;
  /* A scenario run is a slice, not the player's game: the host neither restores nor keeps its saves. */
  if (inScenario) return { ...manifest, saves: false, manualSaveSlots: false };
  if (!manifest.saves) return manifest;
  const saveSchema = instance.serialize().saveSchemaVersion;
  const next: GameManifest = { ...manifest, saveSchema };
  if (typeof instance.migrate === 'function' && saveSchema > 0) next.migratesFrom = saveSchema - 1;
  else delete next.migratesFrom;
  return next;
}

export async function boot<D, S>(module: GameModule<D, S>, options: BootOptions = {}): Promise<Runtime<D, S>> {
  const configuredHostOrigin = options.hostOrigin ?? module.manifest.hostOrigin;
  setMenuActionKinds(module.manifest.inputs.actions);
  const hostOrigin = configuredHostOrigin ? canonicalOrigin(configuredHostOrigin) : originFromDocument();
  const marks: [string, number][] = [['start', markNow()]];
  const queued: HostToGame[] = [];
  const events = new EventRing();
  const runtimeState: { current?: RuntimeImpl<D, S> } = {};
  const saveMachineState: { current?: SaveMachine<S> } = {};
  let eventCursor = 0;
  let lifecyclePaused = false;
  let networkPaused = false;
  let networkProbing = false;
  const deferredRecoveries: Array<Extract<HostToGame, { t: 'net.recovery' }>['payload']> = [];
  let cancelPausePreparation: (() => void) | undefined;
  let networkResumeTimer: ReturnType<typeof setTimeout> | undefined;
  let nextId = 0;
  let resolveHello!: (hello: Extract<HostToGame, { t: 'hello' }>) => void;
  let rejectHello!: (error: unknown) => void;
  let helloSettled = false;
  const helloPromise = new Promise<Extract<HostToGame, { t: 'hello' }>>((resolve, reject) => {
    resolveHello = resolve;
    rejectHello = reject;
  });

  const send: SendEnvelope = (type, payload, replyTo) => {
    const envelope: Envelope<string, unknown> = {
      v: 1,
      id: `sdk-${++nextId}`,
      t: type,
      payload,
      ...(replyTo ? { replyTo } : {}),
    };
    bridge.send(envelope);
  };

  const handleIncoming = (raw: Envelope<string, unknown>) => {
    const parsed = hostToGameSchema.safeParse(raw);
    if (!parsed.success) return;
    const envelope = parsed.data;
    if (envelope.t === 'hello' && !helloSettled) {
      helloSettled = true;
      resolveHello(envelope);
      return;
    }
    if (!runtimeState.current) queued.push(envelope);
    else dispatchRuntime(envelope);
  };

  const bridge = openGameBridge({
    hostOrigin,
    validate: (raw) => {
      const parsed = hostToGameSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    onMessage: handleIncoming,
    helloPayload: { protocol: SDK_PROTOCOL, manifest: module.manifest },
  });
  void bridge.ready.catch((error) => {
    if (!helloSettled) {
      helloSettled = true;
      rejectHello(error);
    }
  });

  const hello = await helloPromise;
  if (hello.payload.protocol !== SDK_PROTOCOL) {
    send('error', { code: 'protocol_mismatch', message: `expected protocol ${SDK_PROTOCOL}` });
    bridge.close();
    throw new Error(`unsupported host protocol ${hello.payload.protocol}`);
  }

  const build: BuildKind = compiledBuild() === 'published' ? 'published' : (options.build ?? compiledBuild());
  if (build === 'published' && new URLSearchParams(location.search).get('build') === 'test') {
    send('error', { code: 'published_test_mode', message: 'published build cannot enable test mode' });
    bridge.close();
    throw new Error('published build cannot enable test mode');
  }

  const stopFaults =
    typeof window !== 'undefined' && !options.headless
      ? installFaultRelay(window, (fault) => send('fault', fault))
      : () => undefined;
  const host = new SdkHostApi(send, (kind, payload) => events.push(++eventCursor, kind, payload));
  const designState: { current?: D } = {};
  try {
    host.setCapabilities(hello.payload.capabilities);
    const initialDesign = module.designSchema.parse({});
    designState.current = structuredClone(initialDesign);
    const scenario = startScenario(module, typeof location === 'undefined' ? '' : location.search);
    const instance = await module.mount(host, initialDesign, scenario?.save);
    const runtime = new RuntimeImpl(
      instance,
      host,
      build,
      hello.payload.mode === 'edit' ? 'edit' : 'play',
      events,
      () => bridge.close(),
    );
    runtime.attachSender(send);
    runtime.addCleanup(stopFaults);
    runtime.addCleanup(installQa(instance));
    runtime.setLocalPlayerIndex(hello.payload.playerIndex);
    runtimeState.current = runtime;
    runtime.addCleanup(() => {
      cancelPausePreparation?.();
      if (networkResumeTimer !== undefined) clearTimeout(networkResumeTimer);
    });
    runtime.installNet(
      createNetController({
        manifest: module.manifest,
        hooks: instance.net,
        localPlayerIndex: hello.payload.playerIndex,
        send: (type, payload) => send(type, payload),
        acceptInput: (frame) => runtime.acceptHostFrame(frame),
        syncPlayers: (players) => runtime.setPlayers(players),
        setLocalPlayerIndex: (playerIndex) => runtime.setLocalPlayerIndex(playerIndex),
        recordEvent: (kind, payload) => events.push(++eventCursor, kind, payload),
        // Network timestamps are Unix-based; simulation time remains on the fixed clock.
        now: () => performance.timeOrigin + performance.now(),
        pauseClock: () => runtime.clock.pause(),
        resumeClock: () => {
          if (!lifecyclePaused && !networkPaused) runtime.clock.resume();
        },
        resetClock: (tick) => runtime.clock.reset(tick),
      }),
    );
    const hooks = new SdkHooks(runtime, module.manifest, marks);
    runtime.attachHooks(hooks);
    host.test.register(hooks);
    const thumbnails =
      !scenario && module.manifest.saves && module.manifest.manualSaveSlots
        ? createSaveThumbnailCache({ onFrame: (callback) => runtime.onFrame(callback) })
        : undefined;
    if (thumbnails) runtime.addCleanup(() => thumbnails.dispose());
    const saveMachine = createSaveMachine({
      instance,
      // A scenario run never writes the player's save.
      send: scenario ? () => undefined : send,
      captureThumbnail: () => thumbnails?.current(),
    });
    saveMachineState.current = saveMachine;
    runtime.addCleanup(() => saveMachine.dispose());
    runtime.onStep(() => saveMachine.markDirty());
    host.setSaveHandler(() => {
      saveMachine.markDirty();
      saveMachine.checkpoint();
    });

    // Hold before announcing readiness, so no simulation step can race an initial restore.
    if (hello.payload.startupHold) {
      lifecyclePaused = true;
      announcePause(true);
      runtime.clock.pause();
      instance.pause();
    }

    // Inline literal check: a bundler that defines __GM_BUILD__ as 'published' drops the adapter chunk.
    if (!(typeof __GM_BUILD__ !== 'undefined' && __GM_BUILD__ === 'published') && build !== 'published') {
      const { installGlobals } = await import('../test/globals.js');
      runtime.addCleanup(installGlobals(hooks, build));
    }

    let frameSignaled = false;
    const frameReady = () => {
      if (frameSignaled) return;
      frameSignaled = true;
      send('load.frame', {});
    };
    if (typeof window !== 'undefined') {
      const observedFrame = () => {
        if (hooks.ready) frameReady();
      };
      window.addEventListener('gm-frame-ready', frameReady, { once: true });
      window.addEventListener('ogm-observed-frame', observedFrame);
      runtime.addCleanup(() => {
        window.removeEventListener('gm-frame-ready', frameReady);
        window.removeEventListener('ogm-observed-frame', observedFrame);
      });
    }
    marks.push(['frame0', markNow()]);
    hooks.ready = true;
    send('ready', {
      protocol: SDK_PROTOCOL,
      manifest: readyManifest(module, instance, scenario !== undefined),
      marks,
      firstFrameSignal: true,
      ...(hello.payload.startupHold ? { startupHold: true } : {}),
    });
    // A game may draw during mount. Check only after its startup continuation can mark itself unready.
    if (!options.headless && typeof requestAnimationFrame === 'function') {
      const paintFrame = requestAnimationFrame(() => {
        if (hooks.ready && Reflect.get(window, '__ogmObservedFrame') === true) frameReady();
      });
      runtime.addCleanup(() => cancelAnimationFrame(paintFrame));
    }
    /* The editor's HD-2D tool reads what the scene renders. A slider drag changes it many times a frame: one report each. */
    let hd2dReport = false;
    const reportHd2d = () => {
      if (hd2dReport) return;
      hd2dReport = true;
      queueMicrotask(() => {
        hd2dReport = false;
        if (runtimeState.current === runtime) send('hd2d.scene', linkedHd2d()?.state() ?? { doc: null });
      });
    };
    runtime.addCleanup(watchHd2d(reportHd2d));
    if (linkedHd2d()) reportHd2d();
    for (const envelope of queued.splice(0)) dispatchRuntime(envelope);
    const trailerCapture =
      build === 'test' &&
      typeof window !== 'undefined' &&
      Boolean((window as Window & { __gmTrailerAudio?: unknown }).__gmTrailerAudio);
    if (!options.headless && !trailerCapture) runtime.startLiveLoop();
    return runtime;
  } catch (error) {
    stopFaults();
    try {
      send('error', { code: 'boot_failed', message: String(error) });
    } catch {
      // The bridge may be the failing dependency; preserve the boot error.
    }
    try {
      if (runtimeState.current) runtimeState.current.dispose();
      else bridge.close();
    } catch {
      // Teardown is best-effort on a failed boot; preserve the boot error.
    }
    throw error;
  }

  function dispatchRuntime(envelope: HostToGame): void {
    const active = runtimeState.current;
    if (!active) return;
    if (envelope.t.startsWith('test.')) {
      if (build === 'published') {
        send('test.result', { ok: false, error: 'published builds refuse test requests' }, envelope.id);
        return;
      }
      if (dispatchTest(envelope, host.registeredHooks() ?? active.hooks, send)) return;
    }

    try {
      switch (envelope.t) {
        case 'hello':
          return;
        case 'navigation.back':
          host.dispatchBack();
          return;
        case 'lifecycle.pause':
          if (lifecyclePaused) return;
          lifecyclePaused = true;
          announcePause(true);
          if (networkPaused || cancelPausePreparation) return;
          saveMachineState.current?.pause();
          active.discardPendingInput();
          active.clock.pause();
          active.instance.pause();
          events.push(++eventCursor, 'pause');
          return;
        case 'lifecycle.resume':
          if (lifecyclePaused) announcePause(false);
          lifecyclePaused = false;
          if (networkPaused) return;
          active.discardPendingInput();
          active.instance.resume();
          active.clock.resume();
          for (const recovery of deferredRecoveries.splice(0)) active.handleNet('net.recovery', recovery);
          events.push(++eventCursor, 'resume');
          return;
        case 'lifecycle.dispose':
          active.dispose();
          return;
        case 'mode.set':
          active.setMode(envelope.payload.mode);
          return;
        case 'design.apply': {
          const design = module.designSchema.safeParse(envelope.payload.doc);
          if (!design.success) {
            send('error', { code: 'apply_failed', message: design.error.message }, envelope.id);
            return;
          }
          const before = active.instance.serialize();
          const nextDesign = structuredClone(design.data);
          try {
            const result = active.instance.applyDesign(nextDesign, envelope.payload.patches);
            designState.current = structuredClone(design.data);
            send('design.applied', { rev: envelope.payload.rev, result }, envelope.id);
          } catch (error) {
            try {
              if ('current' in designState) active.instance.applyDesign(structuredClone(designState.current as D), []);
            } catch {
              // The original apply failure remains the useful host-facing error.
            }
            try {
              active.instance.restore(before);
            } catch {
              // Preserve the original apply failure when game rollback also fails.
            }
            send('error', { code: 'apply_failed', message: String(error) }, envelope.id);
          }
          return;
        }
        case 'editor.select':
          if (active.instance.setSelection) active.instance.setSelection(envelope.payload.ids);
          else send('error', { code: 'unsupported', message: 'selection is not supported' }, envelope.id);
          return;
        case 'editor.camera':
          if (active.instance.setCamera) active.instance.setCamera(envelope.payload.mode, envelope.payload.target);
          else send('error', { code: 'unsupported', message: 'camera modes are not supported' }, envelope.id);
          return;
        case 'hd2d.apply': {
          const link = linkedHd2d();
          if (!link) {
            send('error', { code: 'unsupported', message: 'this scene has no HD-2D' }, envelope.id);
            return;
          }
          try {
            link.apply(envelope.payload.doc, envelope.payload.weather);
          } catch (error) {
            /* The scene keeps the document it had: an editor slip, not a broken game. */
            send('error', { code: 'hd2d_rejected', message: String(error) }, envelope.id);
          }
          return;
        }
        case 'editor.pick':
          send(
            'editor.picked',
            { targets: active.instance.pick?.(envelope.payload.x, envelope.payload.y) ?? [] },
            envelope.id,
          );
          return;
        case 'editor.project':
          send(
            'editor.projected',
            {
              position:
                (envelope.payload.prefab === undefined
                  ? active.instance.screenToWorld?.(envelope.payload.x, envelope.payload.y)
                  : active.instance.screenToWorld?.(envelope.payload.x, envelope.payload.y, envelope.payload.prefab)) ??
                null,
            },
            envelope.id,
          );
          return;
        case 'editor.validatePlacement':
          send(
            'editor.placement',
            active.instance.validatePlacement?.(envelope.payload.prefab, envelope.payload.pose) ?? {
              ok: false,
              reason: 'placement is not supported',
            },
            envelope.id,
          );
          return;
        case 'input.frame':
          // Paused means the host's own dialog has the controls: game menus only note what is held.
          deliverMenuFrame(envelope.payload as ActionFrame, !active.clock.paused);
          active.acceptHostFrame(envelope.payload as ActionFrame);
          return;
        case 'viewport':
          host.updateViewport(envelope.payload as Viewport);
          return;
        case 'settings':
          host.updateSettings(envelope.payload as PlayerSettings);
          return;
        case 'save.restore': {
          let save = envelope.payload as SaveData<unknown>;
          const currentVersion = active.instance.serialize().saveSchemaVersion;
          if (save.saveSchemaVersion !== currentVersion) {
            if (save.saveSchemaVersion !== currentVersion - 1 || !active.instance.migrate) {
              send('error', { code: 'save_unsupported', message: 'save version is not supported' }, envelope.id);
              return;
            }
            save = active.instance.migrate(save);
            if (!save.thumbnail && envelope.payload.thumbnail)
              save = { ...save, thumbnail: envelope.payload.thumbnail };
          }
          active.instance.restore(save as SaveData<S>);
          saveMachineState.current?.restored(save as SaveData<S>);
          if (envelope.payload.saveSchemaVersion !== currentVersion) {
            saveMachineState.current?.migrated(save as SaveData<S>);
          }
          send('save.restored', { save }, envelope.id);
          return;
        }
        case 'net.players':
        case 'net.role':
        case 'net.input':
        case 'net.snapshot':
        case 'net.event':
        case 'net.mode':
        case 'net.seats':
        case 'net.primary':
        case 'net.start':
        case 'net.start.cancel':
        case 'net.epoch.end':
        case 'net.clock':
        case 'net.state':
        case 'net.inputs':
        case 'net.checksum':
        case 'net.recovery.request':
        case 'net.seat':
        case 'net.transport':
          /* Netcode v2 inbound: routing stays N3's, and the SDK consumes the names a per-seat match needs. */
          active.handleNet(envelope.t, envelope.payload);
          return;
        case 'net.recovery':
          if (active.clock.paused) {
            const pending = deferredRecoveries.findIndex(
              (item) => item.scope === envelope.payload.scope && item.seat === envelope.payload.seat,
            );
            if (pending < 0) deferredRecoveries.push(envelope.payload);
            else if (deferredRecoveries[pending]!.tick <= envelope.payload.tick)
              deferredRecoveries[pending] = envelope.payload;
          } else active.handleNet(envelope.t, envelope.payload);
          return;
        case 'net.tick':
          if (!networkPaused && !networkProbing && !cancelPausePreparation)
            active.handleNet(envelope.t, envelope.payload);
          return;
        case 'net.pause.probe':
          networkProbing = true;
          send('net.pause.position', { epoch: envelope.payload.epoch, tick: active.clock.tick });
          return;
        case 'net.pause': {
          networkProbing = false;
          if (networkResumeTimer !== undefined) clearTimeout(networkResumeTimer);
          networkResumeTimer = undefined;
          const wasPreparing = cancelPausePreparation !== undefined;
          cancelPausePreparation?.();
          cancelPausePreparation = undefined;
          if (!networkPaused && (!lifecyclePaused || wasPreparing)) {
            saveMachineState.current?.pause();
            active.discardPendingInput();
            active.clock.pause();
            active.instance.pause();
          }
          networkPaused = true;
          active.handleNet(envelope.t, envelope.payload);
          return;
        }
        case 'net.pause.prepare': {
          networkProbing = false;
          if (networkResumeTimer !== undefined) clearTimeout(networkResumeTimer);
          networkResumeTimer = undefined;
          cancelPausePreparation?.();
          cancelPausePreparation = undefined;
          const { epoch, tick } = envelope.payload;
          const stop = () => {
            cancelPausePreparation?.();
            cancelPausePreparation = undefined;
            saveMachineState.current?.pause();
            active.discardPendingInput();
            active.clock.pause();
            active.instance.pause();
            networkPaused = true;
            active.handleNet('net.pause', { epoch, tick });
            send(active.clock.tick === tick ? 'net.pause.ack' : 'net.pause.late', { epoch, tick });
          };
          if (active.clock.tick >= tick) {
            stop();
            return;
          }
          cancelPausePreparation = active.clock.onStep(() => {
            if (active.clock.tick >= tick) stop();
          });
          if (lifecyclePaused && !networkPaused && active.clock.paused) {
            active.instance.resume();
            active.clock.resume();
          }
          return;
        }
        case 'net.resume': {
          networkProbing = false;
          cancelPausePreparation?.();
          cancelPausePreparation = undefined;
          if (networkResumeTimer !== undefined) clearTimeout(networkResumeTimer);
          const release = () => {
            networkResumeTimer = undefined;
            if (networkPaused && !lifecyclePaused) {
              active.discardPendingInput();
              active.instance.resume();
              active.clock.resume();
            }
            networkPaused = false;
            active.handleNet(envelope.t, envelope.payload);
            if (!lifecyclePaused) {
              for (const recovery of deferredRecoveries.splice(0)) active.handleNet('net.recovery', recovery);
            }
          };
          const at = envelope.payload.at;
          const delay = typeof at === 'number' && Number.isFinite(at) ? Math.max(0, at - active.net.now().serverMs) : 0;
          if (delay > 0) networkResumeTimer = setTimeout(release, delay);
          else release();
          return;
        }
        case 'phase':
          events.push(++eventCursor, 'phase', envelope.payload);
          return;
      }
    } catch (error) {
      const code = envelope.t === 'save.restore' ? 'save_unsupported' : 'runtime_failed';
      send('error', { code, message: String(error) }, envelope.id);
    }
  }
}
