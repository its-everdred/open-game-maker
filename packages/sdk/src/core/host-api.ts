import type { ActionFrame, ActionValue, GmTestHooks, HostApi, PlayerSettings, Viewport } from '@ogm/contracts';

export type SendEnvelope = (type: string, payload: unknown, replyTo?: string) => void;

const defaultViewport: Viewport = {
  w: 0,
  h: 0,
  dpr: 1,
  orientation: 'landscape',
  safe: { top: 0, right: 0, bottom: 0, left: 0 },
};

export class SdkHostApi implements HostApi {
  capabilities: ReadonlySet<string> = new Set();
  private currentViewport = defaultViewport;
  private hooks: GmTestHooks | undefined;
  private readonly inputListeners = new Map<string, Set<(value: ActionValue) => void>>();
  private readonly settingsListeners = new Set<(settings: PlayerSettings) => void>();
  private readonly viewportListeners = new Set<(viewport: Viewport) => void>();
  // Checkpoints delegate to the save machine so it can persist before transport.
  private saveHandler: (() => void) | undefined;

  constructor(
    private readonly send: SendEnvelope,
    private readonly recordEvent: (kind: string, payload: unknown) => void,
  ) {}

  readonly input: HostApi['input'] = {
    on: (action, callback) => {
      const listeners = this.inputListeners.get(action) ?? new Set();
      listeners.add(callback);
      this.inputListeners.set(action, listeners);
      return () => listeners.delete(callback);
    },
  };

  readonly viewport: HostApi['viewport'] = {
    onChange: (callback) => {
      this.viewportListeners.add(callback);
      return () => this.viewportListeners.delete(callback);
    },
    current: () => this.currentViewport,
  };

  readonly events: HostApi['events'] = {
    emit: (kind, payload) => {
      this.recordEvent(kind, payload);
      if (this.capabilities.has('events') || this.capabilities.has(kind) || this.capabilities.has(`events.${kind}`)) {
        this.send('event', { kind, payload });
      }
      if (kind === 'checkpoint') this.saveHandler?.();
    },
  };

  readonly settings: HostApi['settings'] = {
    onChange: (callback) => {
      this.settingsListeners.add(callback);
      return () => this.settingsListeners.delete(callback);
    },
  };

  readonly test: HostApi['test'] = {
    register: (hooks) => {
      this.hooks = hooks;
    },
  };

  registeredHooks(): GmTestHooks | undefined {
    return this.hooks;
  }

  setCapabilities(capabilities: string[]): void {
    this.capabilities = new Set(capabilities);
  }

  setSaveHandler(handler: () => void): void {
    this.saveHandler = handler;
  }

  sendRawKey(payload: { code: string; down: boolean }): void {
    this.send('input.rawKey', payload);
  }

  sendRawKey(payload: { code: string; down: boolean }): void {
    this.send('input.rawKey', payload);
  }

  dispatchInput(frames: ActionFrame[]): void {
    for (const frame of frames) {
      for (const [action, value] of Object.entries(frame.actions)) {
        for (const listener of this.inputListeners.get(action) ?? []) listener(value);
      }
    }
  }

  updateViewport(viewport: Viewport): void {
    this.currentViewport = viewport;
    for (const listener of this.viewportListeners) listener(viewport);
  }

  updateSettings(settings: PlayerSettings): void {
    for (const listener of this.settingsListeners) listener(settings);
  }
}
