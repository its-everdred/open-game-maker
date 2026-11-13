import { SDK_PROTOCOL, hostToGameSchema, type Envelope, type HostToGame } from '@ogm/contracts/bridge';
import type { GameInstance, GameManifest, GameModule, PlayerSettings, SaveData, Viewport } from '@ogm/contracts/game';
import type { ActionFrame } from '@ogm/contracts/input';
import { openGameBridge } from '@ogm/iframe-bridge';

import { EventRing } from './events.js';
import { SdkHostApi, type SendEnvelope } from './host-api.js';
import { RuntimeImpl, type BuildKind, type Runtime } from './runtime.js';
import { createNetController } from '../net/index.js';
import { createSaveMachine, type SaveMachine } from '../saves/machine.js';
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
function readyManifest<D, S>(manifest: GameManifest, instance: GameInstance<D, S>): GameManifest {
  if (!manifest.saves) return manifest;
  const saveSchema = instance.serialize().saveSchemaVersion;
  const next: GameManifest = { ...manifest, saveSchema };
  if (typeof instance.migrate === 'function' && saveSchema > 0) next.migratesFrom = saveSchema - 1;
  else delete next.migratesFrom;
  return next;
}

export async function boot<D, S>(module: GameModule<D, S>, options: BootOptions = {}): Promise<Runtime<D, S>> {
  const configuredHostOrigin = options.hostOrigin ?? module.manifest.hostOrigin;
  const hostOrigin = configuredHostOrigin ? canonicalOrigin(configuredHostOrigin) : originFromDocument();
  const marks: [string, number][] = [['start', markNow()]];
  const queued: HostToGame[] = [];
  const events = new EventRing();
  const runtimeState: { current?: RuntimeImpl<D, S> } = {};
  const saveMachineState: { current?: SaveMachine<S> } = {};
  let eventCursor = 0;
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

  const host = new SdkHostApi(send, (kind, payload) => events.push(++eventCursor, kind, payload));
  const designState: { current?: D } = {};
  try {
    host.setCapabilities(hello.payload.capabilities);
    const initialDesign = module.designSchema.parse({});
    designState.current = structuredClone(initialDesign);
    const instance = await module.mount(host, initialDesign);
    const runtime = new RuntimeImpl(
      instance,
      host,
      build,
      hello.payload.mode === 'edit' ? 'edit' : 'play',
      events,
      () => bridge.close(),
    );
    runtime.attachSender(send);
    runtime.setLocalPlayerIndex(hello.payload.playerIndex);
    runtimeState.current = runtime;
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
        now: markNow,
        pauseClock: () => runtime.clock.pause(),
        resumeClock: () => runtime.clock.resume(),
        resetClock: (tick) => runtime.clock.reset(tick),
      }),
    );
    const hooks = new SdkHooks(runtime, module.manifest, marks);
    runtime.attachHooks(hooks);
    host.test.register(hooks);
    const saveMachine = createSaveMachine({ instance, send });
    saveMachineState.current = saveMachine;
    runtime.addCleanup(() => saveMachine.dispose());
    runtime.onStep(() => saveMachine.markDirty());
    host.setSaveHandler(() => {
      saveMachine.markDirty();
      saveMachine.checkpoint();
    });

    // Inline literal check: a bundler that defines __GM_BUILD__ as 'published' drops the adapter chunk.
    if (!(typeof __GM_BUILD__ !== 'undefined' && __GM_BUILD__ === 'published') && build !== 'published') {
      const { installGlobals } = await import('../test/globals.js');
      runtime.addCleanup(installGlobals(hooks, build));
    }

    marks.push(['frame0', markNow()]);
    hooks.ready = true;
    send('ready', { protocol: SDK_PROTOCOL, manifest: readyManifest(module.manifest, instance), marks });
    for (const envelope of queued.splice(0)) dispatchRuntime(envelope);
    if (!options.headless) runtime.startLiveLoop();
    return runtime;
  } catch (error) {
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
        case 'lifecycle.pause':
          saveMachineState.current?.pause();
          active.clock.pause();
          active.instance.pause();
          events.push(++eventCursor, 'pause');
          return;
        case 'lifecycle.resume':
          active.instance.resume();
          active.clock.resume();
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
            { position: active.instance.screenToWorld?.(envelope.payload.x, envelope.payload.y) ?? null },
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
          }
          active.instance.restore(save as SaveData<S>);
          if (envelope.payload.saveSchemaVersion !== currentVersion) {
            saveMachineState.current?.migrated(save as SaveData<S>);
          }
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
        case 'net.tick':
        case 'net.state':
        case 'net.inputs':
        case 'net.checksum':
        case 'net.recovery':
        case 'net.seat':
        case 'net.transport':
          /* Netcode v2 inbound: routing stays N3's, and the SDK consumes the names a per-seat match needs. */
          active.handleNet(envelope.t, envelope.payload);
          return;
        case 'net.pause':
          active.clock.pause();
          active.handleNet(envelope.t, envelope.payload);
          return;
        case 'net.resume':
          active.clock.resume();
          active.handleNet(envelope.t, envelope.payload);
          return;
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
