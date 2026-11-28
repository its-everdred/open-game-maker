import type { Tier } from '@ogm/contracts/assets';
import { SDK_PROTOCOL, type GameToHost, type HostToGame } from '@ogm/contracts/bridge';
import type { GameManifest } from '@ogm/contracts/game';
import type { RigInputMapping } from '@ogm/contracts/input';

import { HostBridge, type HostFailure, type Role } from './bridge.js';
import { HapticsController } from './haptics.js';
import { GamepadPoller } from './gamepad.js';
import { TouchOverlay } from './overlay.js';
import { SettingsController, type Settings } from './settings.js';
import { ViewportTracker } from './viewport.js';

type HostType = Exclude<HostToGame['t'], 'hello'>;
type GameType = GameToHost['t'];
type HostPayload<T extends HostType> = Extract<HostToGame, { t: T }>['payload'];
type GamePayload<T extends GameType> = Extract<GameToHost, { t: T }>['payload'];
type AudioRelayPayload = Extract<GameToHost, { t: 'audio.relay' }>['payload'];

export type GameLoadEvent =
  | Pick<Extract<GameToHost, { t: 'load.progress' }>, 't' | 'payload'>
  | Pick<Extract<GameToHost, { t: 'load.done' }>, 't' | 'payload'>
  | Pick<Extract<GameToHost, { t: 'load.frame' }>, 't' | 'payload'>;

export interface GameFrameOptions {
  container: HTMLElement;
  gamesOrigin: string;
  appOrigin?: string;
  gameId: string;
  buildId: string;
  /** A scoped preview capability, served outside the published-build service worker scope. */
  preview?: boolean;
  /** Revocable owner access to a draft build. */
  draftGrant?: string;
  build: 'draft' | 'test' | 'published';
  /** Extra query parameters the game reads at boot, such as a review deck's scenario (`speed=slow`). */
  params?: Readonly<Record<string, string>>;
  mode: 'play' | 'edit' | 'test';
  /** Hold simulation until the host finishes restoring the saved game. */
  startupHold?: boolean;
  playerIndex: number;
  tier?: Tier;
  capabilities: string[];
  inputMapping?: Partial<RigInputMapping>;
  role: () => Role;
  onReady?: (manifest: GameManifest, marks: [string, number][], startupHold?: boolean) => void;
  onSaveWrite?: (payload: { saveSchemaVersion: number; data: unknown }) => void;
  onEvent?: (kind: 'achievement' | 'analytics' | 'checkpoint', payload: unknown) => void;
  onLoad?: (event: GameLoadEvent) => void;
  onAudioRelay?: (payload: AudioRelayPayload) => void;
  onRawKey?: (code: string, down: boolean) => void;
  onError?: (failure: HostFailure) => void;
  /** A non-fatal failure inside the game frame (uncaught error, CSP block, failed asset, lost WebGL context). */
  onFault?: (fault: GamePayload<'fault'>) => void;
  readyTimeoutMs?: number;
}

export interface GameFrame {
  iframe: HTMLIFrameElement;
  bridge: HostBridge;
  gamepads: GamepadPoller;
  overlay: TouchOverlay;
  viewport: ViewportTracker;
  send<T extends HostType>(type: T, payload: HostPayload<T>): void;
  request<T extends Extract<HostType, `test.${string}`>>(type: T, payload: HostPayload<T>): Promise<unknown>;
  restoreSave?(payload: HostPayload<'save.restore'>): Promise<HostPayload<'save.restore'>>;
  project(x: number, y: number, prefab?: string): Promise<[number, number, number] | null>;
  pick(x: number, y: number): ReturnType<HostBridge['pick']>;
  on<T extends GameType>(type: T, callback: (payload: GamePayload<T>) => void): () => void;
  setMode(mode: 'play' | 'edit'): void;
  setSettings(settings: Settings): void;
  dispose(): void;
}

export type HostErrorCode = 'same-origin' | 'invalid-origin';

export class HostError extends Error {
  constructor(readonly code: HostErrorCode) {
    super(code);
    this.name = 'HostError';
  }
}

export function createGameFrame(options: GameFrameOptions): GameFrame {
  let gamesOrigin: URL;
  let appOrigin: URL;
  try {
    gamesOrigin = new URL(options.gamesOrigin);
    appOrigin = new URL(options.appOrigin ?? location.origin);
  } catch {
    throw new HostError('invalid-origin');
  }
  if (!['http:', 'https:'].includes(gamesOrigin.protocol) || !['http:', 'https:'].includes(appOrigin.protocol)) {
    throw new HostError('invalid-origin');
  }
  if (gamesOrigin.origin === appOrigin.origin) throw new HostError('same-origin');

  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, { position: 'relative', width: '100%', height: '100%' });
  const iframe = document.createElement('iframe');
  iframe.title = 'Game';
  iframe.setAttribute(
    'sandbox',
    options.preview || options.draftGrant
      ? 'allow-scripts allow-pointer-lock'
      : 'allow-scripts allow-same-origin allow-pointer-lock',
  );
  iframe.setAttribute('allow', 'autoplay; fullscreen; gamepad');
  iframe.setAttribute('referrerpolicy', 'origin');
  Object.assign(iframe.style, { border: '0', width: '100%', height: '100%', display: 'block' });
  const path = options.draftGrant
    ? `/d/${encodeURIComponent(options.gameId)}/${encodeURIComponent(options.buildId)}/${encodeURIComponent(options.draftGrant)}/index.html`
    : `/${options.preview ? 'p' : 'g'}/${encodeURIComponent(options.gameId)}/${encodeURIComponent(options.buildId)}/index.html`;
  const source = new URL(path, gamesOrigin.origin);
  /* The host's own parameters are set after, so a scenario can never change the build or the protocol. */
  for (const [key, value] of Object.entries(options.params ?? {})) source.searchParams.set(key, value);
  source.searchParams.set('build', options.build);
  source.searchParams.set('protocol', String(SDK_PROTOCOL));
  source.searchParams.set('frameObserver', '2');
  iframe.src = source.href;
  const layer = document.createElement('div');
  wrapper.append(iframe, layer);
  options.container.append(wrapper);

  let sdkSignalsFrame: boolean | undefined;
  let pendingObservedFrame = false;
  const observeFirstFrame = (event: MessageEvent) => {
    if (
      !iframe.contentWindow ||
      event.source !== iframe.contentWindow ||
      event.origin !== (options.preview || options.draftGrant ? 'null' : gamesOrigin.origin)
    )
      return;
    if (typeof event.data !== 'object' || event.data === null || event.data.type !== 'ogm.frame.ready.v2') return;
    if (sdkSignalsFrame === undefined) pendingObservedFrame = true;
    else if (!sdkSignalsFrame) firstFrame();
  };
  window.addEventListener('message', observeFirstFrame);

  /* The controls wait for the game's first frame, so they never cover its loading screen. */
  const firstFrame = () => {
    overlay.setLoading(false);
    options.onLoad?.({ t: 'load.frame', payload: {} });
  };

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('message', observeFirstFrame);
    gamepads.stop();
    overlay.dispose();
    viewport.dispose();
    bridge.close();
    wrapper.remove();
  };
  const bridge = new HostBridge({
    iframe,
    origin: gamesOrigin.origin,
    ...(options.preview || options.draftGrant ? { opaqueOrigin: true } : {}),
    role: options.role,
    readyTimeoutMs: options.readyTimeoutMs,
    onFatal: dispose,
    hello: {
      protocol: SDK_PROTOCOL,
      capabilities: [...new Set([...options.capabilities, 'haptics'])],
      mode: options.mode,
      ...(options.startupHold ? { startupHold: true } : {}),
      build: options.build,
      playerIndex: options.playerIndex,
      tier: options.tier,
    },
  });
  if (options.preview || options.draftGrant) {
    let loaded = false;
    iframe.addEventListener('load', () => {
      if (!loaded) {
        loaded = true;
        return;
      }
      options.onError?.({ code: 'frame-navigation', message: 'The preview navigated away.' });
      dispose();
    });
  }
  bridge.onError((failure) => options.onError?.(failure));

  const overlay = new TouchOverlay({
    layer,
    inputs: { actions: {} },
    touch: 'tap',
    playerIndex: options.playerIndex,
    onFrame: (frame) => bridge.send('input.frame', frame),
  });
  overlay.setLoading(true);
  const gamepads = new GamepadPoller({ onActivity: (at) => overlay.noteGamepadInput(at) });
  let controlInputs: GameManifest['inputs'] | undefined;
  let legacySelfControls = false;
  let frameMode = options.mode;
  let controlLayout = 'gameplay';
  const updateGamepad = (contextChanged = false) => {
    if (!controlInputs) return;
    const controls = controlInputs.controls;
    const selected = controls && Object.hasOwn(controls, controlLayout) ? controls[controlLayout] : undefined;
    if (!selected) return gamepads.setMapping(options.inputMapping?.gamepad, controlInputs.actions, contextChanged);
    const actions: GameManifest['inputs']['actions'] = Object.create(null) as GameManifest['inputs']['actions'];
    const sticks =
      selected.layout === 'tap'
        ? []
        : [selected.stick, ...(selected.layout === 'two-stick' ? [selected.secondStick] : [])];
    for (const action of sticks) {
      if (action && controlInputs.actions[action] === 'stick') actions[action] = 'stick';
    }
    for (const button of selected.buttons) {
      if (controlInputs.actions[button.action] === 'button') actions[button.action] = 'button';
    }
    const explicit = options.inputMapping?.gamepad ?? {};
    const bindings: Record<string, string> = Object.create(null) as Record<string, string>;
    const used = new Set(
      selected.buttons.flatMap(({ action }) => (Object.hasOwn(explicit, action) ? [explicit[action]!] : [])),
    );
    for (const { action, icon } of selected.buttons) {
      const preferred = icon === 'confirm' ? 'a' : icon === 'back' ? 'b' : undefined;
      if (!Object.hasOwn(explicit, action) && preferred && !used.has(preferred)) {
        bindings[action] = preferred;
        used.add(preferred);
      }
    }
    for (const { action } of selected.buttons) {
      if (Object.hasOwn(explicit, action) || Object.hasOwn(bindings, action)) continue;
      const available = ['a', 'x', 'b', 'y', 'lb', 'rb'].find((button) => !used.has(button));
      if (available) {
        bindings[action] = available;
        used.add(available);
      }
    }
    gamepads.setMapping({ ...bindings, ...explicit }, actions, contextChanged);
  };
  gamepads.onFrame((frame) => bridge.send('input.frame', frame));
  const viewport = new ViewportTracker({
    container: options.container,
    send: (value) => bridge.send('viewport', value),
  });
  const haptics = new HapticsController();
  const settings = new SettingsController((value) => bridge.send('settings', value));

  bridge.on('ready', ({ manifest, marks, firstFrameSignal, startupHold }) => {
    sdkSignalsFrame = firstFrameSignal === true;
    if (!sdkSignalsFrame && pendingObservedFrame) firstFrame();
    const { touch: legacyTouch, ...inputs } = manifest.inputs;
    if (legacyTouch === 'self' && options.build !== 'published') {
      options.onError?.({ code: 'invalid-controls', message: 'Self-drawn controls are not allowed in new builds.' });
      return;
    }
    legacySelfControls = legacyTouch === 'self';
    const normalizedManifest: GameManifest = { ...manifest, inputs };
    controlInputs = inputs;
    updateGamepad();
    const sticks = Object.values(inputs.actions).filter((kind) => kind === 'stick').length;
    const touch = options.inputMapping?.touch ?? (sticks > 1 ? 'two-stick' : 'stick');
    overlay.setInputs(inputs, touch);
    overlay.setEnabled(frameMode === 'play' && !legacySelfControls);
    viewport.sendNow();
    settings.resend();
    options.onReady?.(normalizedManifest, marks, startupHold === true);
  });
  bridge.on('haptics.pulse', ({ pattern }) => haptics.pulse(pattern));
  bridge.on('save.write', (payload) => options.onSaveWrite?.(payload));
  bridge.on('event', ({ kind, payload }) => options.onEvent?.(kind, payload));
  bridge.on('fault', (payload) => options.onFault?.(payload));
  bridge.on('load.progress', (payload) => options.onLoad?.({ t: 'load.progress', payload }));
  bridge.on('load.frame', (payload) => {
    overlay.setLoading(false);
    options.onLoad?.({ t: 'load.frame', payload });
  });
  bridge.on('host.controls', ({ layout }) => {
    const contextChanged = layout !== controlLayout;
    controlLayout = layout;
    overlay.setLayout(layout);
    updateGamepad(contextChanged);
  });
  bridge.on('load.done', (payload) => options.onLoad?.({ t: 'load.done', payload }));
  bridge.on('audio.relay', (payload) => options.onAudioRelay?.(payload));
  bridge.on('input.rawKey', ({ code, down }) => {
    overlay.noteKeyboardInput();
    options.onRawKey?.(code, down);
  });
  gamepads.setMode(options.mode === 'edit' ? 'edit' : 'play');
  overlay.setEnabled(options.mode === 'play');
  gamepads.start();

  return {
    iframe,
    bridge,
    gamepads,
    overlay,
    viewport,
    send: bridge.send.bind(bridge) as GameFrame['send'],
    request: bridge.request.bind(bridge) as GameFrame['request'],
    restoreSave: bridge.restoreSave.bind(bridge),
    project: bridge.project.bind(bridge),
    pick: bridge.pick.bind(bridge),
    on: bridge.on.bind(bridge) as GameFrame['on'],
    setMode: (mode) => {
      if (!bridge.send('mode.set', { mode })) return;
      frameMode = mode;
      gamepads.setMode(mode);
      overlay.setEnabled(mode === 'play' && !legacySelfControls);
    },
    setSettings: (value) => {
      haptics.setSettings(value);
      settings.set(value);
    },
    dispose,
  };
}
