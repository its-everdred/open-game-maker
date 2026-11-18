export type AudioStatus = 'tap' | 'on' | 'off';

type AudioNavigator = Navigator & { audioSession?: { type: string } };

interface UnlockOptions {
  context: AudioContext;
  win: Window;
  isMuted: () => boolean;
  onRunning: () => void;
}

const UNLOCK_EVENTS = ['pointerup', 'touchend', 'keydown', 'click'] as const;

/** The window event the SDK runtime dispatches when the host pauses or resumes the game (`detail.paused`). */
export const GM_PAUSE_EVENT = 'gm-pause';
/** The window property holding the latest pause state, for audio a game creates while already paused. */
export const GM_PAUSED_FLAG = '__gmPaused';

export class AudioUnlock {
  private readonly listeners = new Set<(status: AudioStatus) => void>();
  private managesVisibilityState = false;
  private pending: Promise<void> | null = null;
  private visibilityTransition = Promise.resolve();
  private disposed = false;
  /** The host has the game paused: audio stays suspended, even when the page becomes visible again (#874). */
  private held = false;
  private heldSuspended = false;

  constructor(private readonly options: UnlockOptions) {
    for (const event of UNLOCK_EVENTS) options.win.addEventListener(event, this.unlock, { capture: true });
    options.context.addEventListener('statechange', this.stateChanged);
    options.win.document.addEventListener('visibilitychange', this.visibilityChanged);
    options.win.addEventListener(GM_PAUSE_EVENT, this.pauseChanged);
    if (Reflect.get(options.win, GM_PAUSED_FLAG) === true) {
      this.pauseChanged(new CustomEvent(GM_PAUSE_EVENT, { detail: { paused: true } }));
    }
  }

  readonly unlock = (): Promise<void> => {
    const { context, win } = this.options;
    try {
      const audioSession = (win.navigator as AudioNavigator).audioSession;
      if (audioSession) audioSession.type = 'playback';
    } catch {
      // Audio Session is a Safari extension and can reject assignment.
    }
    if (this.held || context.state === 'running' || win.document.hidden) return Promise.resolve();
    if (this.pending) return this.pending;

    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, 22_050);
    source.connect(context.destination);
    source.start(0);
    this.pending = context
      .resume()
      .catch(() => {
        // A later user gesture or statechange can retry the unlock.
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  };

  status(): AudioStatus {
    if (this.options.isMuted()) return 'off';
    if (this.heldSuspended) return 'on';
    return this.options.context.state === 'running' ? 'on' : 'tap';
  }

  onStatus(callback: (status: AudioStatus) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  refresh(): void {
    this.notify();
  }

  dispose(): void {
    this.disposed = true;
    for (const event of UNLOCK_EVENTS) this.options.win.removeEventListener(event, this.unlock, true);
    this.options.context.removeEventListener('statechange', this.stateChanged);
    this.options.win.document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.options.win.removeEventListener(GM_PAUSE_EVENT, this.pauseChanged);
    this.listeners.clear();
  }

  private readonly stateChanged = (): void => {
    if (this.options.context.state === 'running') this.options.onRunning();
    this.notify();
  };

  private readonly visibilityChanged = (): void => {
    const { context, win } = this.options;
    if (win.document.hidden && !this.managesVisibilityState && context.state === 'running') {
      this.managesVisibilityState = true;
    }
    if (!this.managesVisibilityState) return;

    this.visibilityTransition = this.visibilityTransition
      .catch(() => {})
      .then(async () => {
        if (this.disposed || !this.managesVisibilityState) return;
        if (win.document.hidden) {
          if (context.state === 'running') await context.suspend();
          return;
        }
        if (this.held) {
          this.heldSuspended = true;
          this.managesVisibilityState = false;
          return;
        }
        if (context.state !== 'running') await context.resume();
        if (!win.document.hidden) this.managesVisibilityState = false;
      })
      .catch(() => {
        // A later visibility event can retry after a browser lifecycle rejection.
      });
  };

  private readonly pauseChanged = (event: Event): void => {
    const paused = (event as CustomEvent<{ paused?: unknown } | null>).detail?.paused === true;
    if (paused === this.held) return;
    this.held = paused;
    const { context, win } = this.options;
    this.visibilityTransition = this.visibilityTransition
      .catch(() => {})
      .then(async () => {
        if (this.disposed) return;
        if (this.held) {
          if (context.state !== 'running') return;
          this.heldSuspended = true;
          await context.suspend();
          return;
        }
        if (!this.heldSuspended) return;
        this.heldSuspended = false;
        // Resumed in a hidden tab: the next visibility change brings the sound back.
        if (win.document.hidden) this.managesVisibilityState = true;
        else if (context.state !== 'running') await context.resume();
      })
      .catch(() => {
        // A later visibility event or gesture can retry after a browser lifecycle rejection.
      });
  };

  private notify(): void {
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }
}
