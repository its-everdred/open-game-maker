/** Opt-in capture channel installed by the trailer recorder before the game loads. */
export type TrailerAudioEvent =
  | { type: 'sample'; timeMs: number; id: string; url: string; gain: number; rate: number }
  | { type: 'music'; timeMs: number; id: string; url: string; gain: number; fade: number }
  | { type: 'music-stop'; timeMs: number; fade: number }
  | { type: 'music-gain'; timeMs: number; target: number; timeConstant: number }
  | { type: 'synth'; timeMs: number; samples: number[]; gain: number };

export type TrailerAudioCapture = {
  timeMs: number;
  events: TrailerAudioEvent[];
  unsupported: string[];
  sdk?: boolean;
  musicGain?: number;
};

export function trailerCapture(win: Window): TrailerAudioCapture | undefined {
  return (win as Window & { __gmTrailerAudio?: TrailerAudioCapture }).__gmTrailerAudio;
}

/** Presentation time advances while the simulation is paused, just like the recorded video. */
export function trailerTime(_win: Window, capture: TrailerAudioCapture): number {
  return capture.timeMs;
}
