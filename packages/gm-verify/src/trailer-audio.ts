/** A sound actually played by the game, timed from the start of the recording. */
export type TrailerCue = { file: string; time: number; gain: number; loop?: boolean };

/** Build an ffmpeg mix without interpolating file names into the filter graph. */
export function trailerAudioArgs(input: string, output: string, duration: number, cues: TrailerCue[]): string[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('duration must be positive');
  for (const cue of cues) {
    if (!cue.file || !Number.isFinite(cue.time) || cue.time < 0 || !Number.isFinite(cue.gain) || cue.gain < 0)
      throw new Error('invalid trailer audio cue');
  }
  const inputs = cues.flatMap((cue) => [...(cue.loop ? ['-stream_loop', '-1'] : []), '-i', cue.file]);
  const filters = cues.map(
    (cue, i) => `[${i + 1}:a]volume=${cue.gain},adelay=${Math.round(cue.time * 1000)}:all=1[a${i}]`,
  );
  // A silent bed ensures the track spans the complete clip, including gaps and an empty cue list.
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[bed]`);
  filters.push(
    `[bed]${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length + 1}:duration=first:normalize=0,alimiter=limit=0.891[a]`,
  );
  return [
    '-i',
    input,
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '0:v:0',
    '-map',
    '[a]',
    '-t',
    String(duration),
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    output,
  ];
}
