/** A sound requested by the game, timed from the start of the recording. */
export type TrailerCue = {
  file: string;
  time: number;
  gain: number;
  loop?: boolean;
  rate?: number;
  length?: number;
  fadeIn?: number;
  fadeOut?: number;
};

/** Build an ffmpeg mix without interpolating file names into the filter graph. */
export function trailerAudioArgs(input: string, output: string, duration: number, cues: TrailerCue[]): string[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('duration must be positive');
  for (const cue of cues) {
    if (
      !cue.file ||
      !Number.isFinite(cue.time) ||
      cue.time < 0 ||
      !Number.isFinite(cue.gain) ||
      cue.gain < 0 ||
      (cue.rate !== undefined && (!Number.isFinite(cue.rate) || cue.rate <= 0)) ||
      (cue.length !== undefined && (!Number.isFinite(cue.length) || cue.length <= 0)) ||
      [cue.fadeIn, cue.fadeOut].some((n) => n !== undefined && (!Number.isFinite(n) || n < 0))
    )
      throw new Error('invalid trailer audio cue');
  }
  const inputs = cues.flatMap((cue) => [...(cue.loop ? ['-stream_loop', '-1'] : []), '-i', cue.file]);
  const filters = cues.map((cue, i) => {
    const parts = [`[${i + 1}:a]aresample=48000`];
    if (cue.rate !== undefined && cue.rate !== 1)
      parts.push(`asetrate=${Math.round(48000 * cue.rate)}`, 'aresample=48000');
    if (cue.length !== undefined) parts.push(`atrim=duration=${cue.length}`);
    if (cue.fadeIn) parts.push(`afade=t=in:st=0:d=${cue.fadeIn}`);
    if (cue.fadeOut && cue.length)
      parts.push(`afade=t=out:st=${Math.max(0, cue.length - cue.fadeOut)}:d=${cue.fadeOut}`);
    parts.push(`volume=${cue.gain}`, `adelay=${Math.round(cue.time * 1000)}:all=1[a${i}]`);
    return parts.join(',');
  });
  // A silent bed ensures the track spans the complete clip, including gaps and an empty cue list.
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[bed]`);
  filters.push(
    `[bed]${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length + 1}:duration=first:normalize=0,alimiter=limit=0.891:level=0:latency=1[a]`,
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
