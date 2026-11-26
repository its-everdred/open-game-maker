import sharp from 'sharp';

/** The fields of a hosted build's `manifest.json` the play check reads. */
export type PlayManifest = {
  title?: string;
  modes?: { tap?: string }[];
  playArea?: false | { tap?: string };
  controlBindings?: Record<string, string>;
  inputs?: { actions?: Record<string, string>; touch?: string };
};

/** One bridge message type seen by the shell; repeats of the same type in a row fold into `n`. */
export type PlayTraceEntry = { ms: number; dir: 'in' | 'out' | 'window'; t: string; n: number };

export type PlayInput = 'stick' | 'key' | 'swipe';

export type PlayObservation = {
  /** The shell's bridge state when the check ended (`__ogmHost.game.bridgeState`). */
  bridgeState: string | undefined;
  trace: PlayTraceEntry[];
  /** Milliseconds from opening the game to bridge ready plus first frame; null when that never happened in time. */
  bootMs: number | null;
  /** The shell's "Try again" button was on screen when the check ended. */
  tryAgain: boolean;
  tapPath: string[];
  /** The tap that never became tappable, if any. */
  tapFailed?: string;
  /** Luminance spread of the game frame after the tap path; near zero is a blank or covered frame. */
  frameStddev: number | null;
  /** Share of the game frame that changed with no input, and across one input. */
  idleChange: number | null;
  inputChange: number | null;
  input: PlayInput | null;
  /** The host should draw a move stick (a `move` stick the game does not draw itself): a swipe then means it is gone. */
  expectsStick: boolean;
  /** Why the check stopped before it finished (its deadline, a browser crash). */
  stopped?: string;
};

export type PlayVerdict = { failures: string[]; unchecked: string[] };

/** A frame whose luminance barely varies is a flat loading layer or an empty canvas, not a game. */
export const BLANK_STDDEV = 4;
/** One input must change this much more of the frame than the same wait without input. */
export const MIN_INPUT_CHANGE = 0.02;

/** The tap path a player takes from the title into play: the first mode's, else the play area's. */
export function firstTapPath(manifest: PlayManifest): string[] {
  const tap = manifest.modes?.find((mode) => mode.tap)?.tap ?? (manifest.playArea ? manifest.playArea.tap : undefined);
  return tap
    ? tap
        .split('>')
        .map((text) => text.trim())
        .filter(Boolean)
    : [];
}

/** The game declares a `move` stick and leaves touch controls to the host, so the host must draw that stick. */
export function expectsHostStick(manifest: PlayManifest): boolean {
  return manifest.inputs?.actions?.move === 'stick' && manifest.inputs.touch !== 'self';
}

/** The key bound to a move, rightward first: one step of the player when the host draws no stick. */
export function moveKey(manifest: PlayManifest): string | undefined {
  const bindings = Object.entries(manifest.controlBindings ?? {});
  return (bindings.find(([, action]) => action === 'move.right') ??
    bindings.find(([, action]) => action.startsWith('move')))?.[0];
}

/**
 * The target game's API answers, from its published build. The QA account cannot read another family's private game,
 * so the check answers only that game's own routes and lets every other request reach the real API. Writes are
 * absorbed so a QA run never records a play or a save on someone's game.
 */
export function gameApiAnswer(input: {
  gameId: string;
  buildId: string;
  title: string;
  doc: unknown;
  method: string;
  /** The path after `/api/v1/games/<gameId>`, without the query. */
  path: string;
}): { status: number; body?: unknown } {
  if (input.method !== 'GET') return { status: 204 };
  if (input.path === '')
    return {
      status: 200,
      body: {
        id: input.gameId,
        familyId: 'qa-play-check',
        ownerId: 'qa-play-check',
        title: input.title,
        slug: null,
        visibility: 'private',
        repoVisibility: 'private',
        repo: null,
        createdAt: '1970-01-01T00:00:00.000Z',
        delistedAt: null,
        allowAiGeneratedAssets: false,
        creationStatus: 'ready',
      },
    };
  if (input.path === '/branches/main/design')
    return { status: 200, body: { rev: 1, buildId: input.buildId, doc: input.doc } };
  if (input.path === '/saves') return { status: 200, body: { slots: [] } };
  return { status: 404, body: { error: 'not_found' } };
}

/** Did the game report a first frame to the shell? */
export function sawFirstFrame(trace: readonly PlayTraceEntry[]): boolean {
  return trace.some((entry) => entry.dir === 'in' && entry.t === 'load.frame');
}

/** Keep the last observed bridge state when the browser can no longer answer. */
export function updatePlayState(
  observation: PlayObservation,
  state: { bridge: string | undefined; trace: PlayTraceEntry[] } | null,
): boolean {
  if (state === null) return false;
  observation.bridgeState = state.bridge;
  observation.trace = state.trace;
  return true;
}

/** A late first frame is usable; without one the cause of a boot timeout is unknown. */
export function bootDeadlineFailure(bridge: string | undefined, firstFrameSeen: boolean): string | undefined {
  return bridge === 'ready' && firstFrameSeen
    ? undefined
    : 'inconclusive: boot exceeded its wall-time budget; inspect bridge trace to distinguish game and host';
}

export function judgePlay(observation: PlayObservation): PlayVerdict {
  const failures: string[] = [];
  const unchecked: string[] = [];
  if (observation.stopped !== undefined) failures.push(`the check stopped: ${observation.stopped}`);
  if (observation.bridgeState === 'error' || (observation.stopped === undefined && observation.bridgeState !== 'ready'))
    failures.push(`bridge ${observation.bridgeState ?? 'never connected'}`);
  if (observation.tryAgain) failures.push('the shell shows Try again');
  if (observation.stopped === undefined) {
    if (!sawFirstFrame(observation.trace)) failures.push('the game never reported load.frame');
    else if (observation.bootMs === null) failures.push('the game did not reach ready and its first frame in time');
  }
  if (observation.tapFailed !== undefined) failures.push(`could not tap "${observation.tapFailed}"`);
  if (!observation.tapPath.length) unchecked.push('the manifest names no tap path: checked from the first screen');
  if (observation.frameStddev !== null && observation.frameStddev < BLANK_STDDEV)
    failures.push(`the game frame is blank (luminance spread ${observation.frameStddev.toFixed(1)})`);
  if (observation.inputChange !== null && observation.idleChange !== null) {
    const measured = `idle ${share(observation.idleChange)}, input ${share(observation.inputChange)}`;
    const moved = observation.inputChange - observation.idleChange >= MIN_INPUT_CHANGE;
    // Without a host stick or a move key the swipe is a guess at the game's controls: a still frame is not proof it broke.
    if (!moved && observation.input === 'swipe' && !observation.expectsStick)
      unchecked.push(`no host stick or move key to try, and a swipe changed nothing (${measured})`);
    else if (!moved) failures.push(`one ${observation.input ?? 'input'} did not change the frame (${measured})`);
  } else if (!failures.length) failures.push('no input was tried');
  return { failures, unchecked };
}

function share(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Downscaled RGB pixels, so the comparison ignores sub-pixel noise and stays fast. */
async function thumbnail(png: Buffer): Promise<Buffer> {
  return sharp(png).resize(96, 96, { fit: 'fill' }).removeAlpha().raw().toBuffer();
}

/** Standard deviation of the frame's luminance. */
export async function frameStddev(png: Buffer): Promise<number> {
  const pixels = await thumbnail(png);
  const values: number[] = [];
  for (let index = 0; index < pixels.length; index += 3)
    values.push(pixels[index]! * 0.2126 + pixels[index + 1]! * 0.7152 + pixels[index + 2]! * 0.0722);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

/** Share of the frame whose colour moved by more than a little between two shots. */
export async function changedShare(before: Buffer, after: Buffer): Promise<number> {
  const [a, b] = await Promise.all([thumbnail(before), thumbnail(after)]);
  let changed = 0;
  for (let index = 0; index < a.length; index += 3) {
    const delta =
      Math.abs(a[index]! - b[index]!) +
      Math.abs(a[index + 1]! - b[index + 1]!) +
      Math.abs(a[index + 2]! - b[index + 2]!);
    if (delta > 48) changed += 1;
  }
  return changed / (a.length / 3);
}

/**
 * Runs in the shell page before its scripts: records the bridge's message types in both directions (the bridge talks
 * over a MessagePort; the game's hello arrives on the window). Other ports (React's scheduler) carry no `t` and are
 * skipped. Self-contained: Playwright serializes it into the page.
 *
 * `stallMs` (replays only) holds the game's load reports after its first one for that long, then delivers them in
 * order: the silence Blobs leaves while it compiles shaders on a loaded phone (#1267), on demand.
 */
export function installPlayTrace(stallMs = 0): void {
  const host = window as unknown as { __playTrace?: PlayTraceEntry[] };
  const trace: PlayTraceEntry[] = (host.__playTrace = []);
  const start = performance.now();
  const note = (dir: PlayTraceEntry['dir'], data: unknown): string | undefined => {
    let type: unknown;
    try {
      type = (typeof data === 'string' ? (JSON.parse(data) as { t?: unknown }) : (data as { t?: unknown } | null))?.t;
    } catch {
      return undefined;
    }
    if (typeof type !== 'string') return undefined;
    const last = trace[trace.length - 1];
    if (last && last.dir === dir && last.t === type) last.n += 1;
    else if (trace.length < 300) trace.push({ ms: Math.round(performance.now() - start), dir, t: type, n: 1 });
    return type;
  };
  let stallUntil: number | undefined;
  const held: (() => unknown)[] = [];
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (this: MessagePort, ...args: Parameters<MessagePort['postMessage']>) {
    note('out', args[0]);
    return post.apply(this, args);
  } as MessagePort['postMessage'];
  const onmessage = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage')!;
  Object.defineProperty(MessagePort.prototype, 'onmessage', {
    configurable: true,
    get(this: MessagePort) {
      return onmessage.get!.call(this) as unknown;
    },
    set(this: MessagePort, handler: unknown) {
      onmessage.set!.call(
        this,
        typeof handler === 'function'
          ? function (this: MessagePort, event: MessageEvent) {
              const type = note('in', event.data);
              const deliver = () => (handler as (event: MessageEvent) => unknown).call(this, event);
              if (stallMs > 0 && type?.startsWith('load.')) {
                // The first report arms the shell's stall timer; the silence starts after it.
                if (stallUntil === undefined) {
                  stallUntil = performance.now() + stallMs;
                  return deliver();
                }
                if (held.length || performance.now() < stallUntil) {
                  if (!held.length)
                    setTimeout(() => held.splice(0).forEach((release) => release()), stallUntil - performance.now());
                  held.push(deliver);
                  return undefined;
                }
              }
              return deliver();
            }
          : handler,
      );
    },
  });
  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) note('window', event.data);
    },
    true,
  );
}
