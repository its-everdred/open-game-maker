/** Opt-in capture channel installed by the trailer recorder before the game loads. */
export type TrailerAudioEvent =
  | { type: 'sample'; timeMs: number; id: string; url: string; gain: number; rate: number }
  | { type: 'music'; timeMs: number; id: string; url: string; gain: number; fade: number }
  | { type: 'music-stop'; timeMs: number; fade: number }
  | { type: 'synth'; timeMs: number; samples: number[]; gain: number };

export type TrailerAudioCapture = { timeMs: number; events: TrailerAudioEvent[]; unsupported: string[]; sdk?: boolean };

export function trailerCapture(win: Window): TrailerAudioCapture | undefined {
  return (win as Window & { __gmTrailerAudio?: TrailerAudioCapture }).__gmTrailerAudio;
}

/** Prefer the current SDK tick so cues raised inside a multi-step advance keep their exact game time. */
export function trailerTime(win: Window, capture: TrailerAudioCapture): number {
  const gm = (win as Window & { __gm?: { probes?: () => Record<string, unknown> } }).__gm;
  let tick: unknown;
  try {
    tick = gm?.probes?.().tick;
  } catch {
    return capture.timeMs;
  }
  return typeof tick === 'number' && Number.isFinite(tick) && tick >= 0 ? (tick * 1000) / 60 : capture.timeMs;
}
