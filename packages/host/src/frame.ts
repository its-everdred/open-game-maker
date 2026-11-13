import type { Tier } from '@ogm/contracts/assets';
import { SDK_PROTOCOL, type GameToHost, type HostToGame } from '@ogm/contracts/bridge';
import type { GameManifest } from '@ogm/contracts/game';
import type { RigInputMapping } from '@ogm/contracts/input';

import { HostBridge, type HostFailure, type Role } from './bridge.js';
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
  | Pick<Extract<GameToHost, { t: 'load.done' }>, 't' | 'payload'>;

export interface GameFrameOptions {
  container: HTMLElement;
  gamesOrigin: string;
  appOrigin?: string;
  gameId: string;
  buildId: string;
  build: 'draft' | 'test' | 'published';
  /** Extra query parameters the game reads at boot, such as a review deck's scenario (`speed=slow`). */
  params?: Readonly<Record<string, string>>;
  mode: 'play' | 'edit' | 'test';
  playerIndex: number;
  tier?: Tier;
  capabilities: string[];
  inputMapping?: Partial<RigInputMapping>;
  role: () => Role;
  onReady?: (manifest: GameManifest, marks: [string, number][]) => void;
  onSaveWrite?: (payload: { saveSchemaVersion: number; data: unknown }) => void;
  onEvent?: (kind: 'achievement' | 'analytics' | 'checkpoint', payload: unknown) => void;
  onLoad?: (event: GameLoadEvent) => void;
  onAudioRelay?: (payload: AudioRelayPayload) => void;
  onRawKey?: (code: string, down: boolean) => void;
  onError?: (failure: HostFailure) => void;
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
  project(x: number, y: number): Promise<[number, number, number] | null>;
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
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
  iframe.setAttribute('allow', 'autoplay; fullscreen; gamepad');
  iframe.setAttribute('referrerpolicy', 'origin');
  Object.assign(iframe.style, { border: '0', width: '100%', height: '100%', display: 'block' });
  const path = `/g/${encodeURIComponent(options.gameId)}/${encodeURIComponent(options.buildId)}/index.html`;
  const source = new URL(path, gamesOrigin.origin);
  /* The host's own parameters are set after, so a scenario can never change the build or the protocol. */
  for (const [key, value] of Object.entries(options.params ?? {})) source.searchParams.set(key, value);
  source.searchParams.set('build', options.build);
  source.searchParams.set('protocol', String(SDK_PROTOCOL));
  iframe.src = source.href;
  const layer = document.createElement('div');
  wrapper.append(iframe, layer);
  options.container.append(wrapper);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    gamepads.stop();
    overlay.dispose();
    viewport.dispose();
    bridge.close();
    wrapper.remove();
  };
  const bridge = new HostBridge({
    iframe,
    origin: gamesOrigin.origin,
    role: options.role,
    readyTimeoutMs: options.readyTimeoutMs,
    onFatal: dispose,
    hello: {
      protocol: SDK_PROTOCOL,
      capabilities: options.capabilities,
      mode: options.mode,
      build: options.build,
      playerIndex: options.playerIndex,
      tier: options.tier,
    },
  });
  bridge.onError((failure) => options.onError?.(failure));

  const overlay = new TouchOverlay({
    layer,
    inputs: { actions: {} },
    touch: 'tap',
    playerIndex: options.playerIndex,
    onFrame: (frame) => bridge.send('input.frame', frame),
  });
  const gamepads = new GamepadPoller({ onActivity: (at) => overlay.noteGamepadInput(at) });
  gamepads.onFrame((frame) => bridge.send('input.frame', frame));
  const viewport = new ViewportTracker({
    container: options.container,
    send: (value) => bridge.send('viewport', value),
  });
  const settings = new SettingsController((value) => bridge.send('settings', value));

  bridge.on('ready', ({ manifest, marks }) => {
    gamepads.setMapping(options.inputMapping?.gamepad, manifest.inputs.actions);
    overlay.setInputs(manifest.inputs, options.inputMapping?.touch ?? 'tap');
    viewport.sendNow();
    settings.resend();
    options.onReady?.(manifest, marks);
  });
  bridge.on('save.write', (payload) => options.onSaveWrite?.(payload));
  bridge.on('event', ({ kind, payload }) => options.onEvent?.(kind, payload));
  bridge.on('load.progress', (payload) => options.onLoad?.({ t: 'load.progress', payload }));
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
    project: bridge.project.bind(bridge),
    on: bridge.on.bind(bridge) as GameFrame['on'],
    setMode: (mode) => {
      if (!bridge.send('mode.set', { mode })) return;
      gamepads.setMode(mode);
      overlay.setEnabled(mode === 'play');
    },
    setSettings: (value) => settings.set(value),
    dispose,
  };
}
