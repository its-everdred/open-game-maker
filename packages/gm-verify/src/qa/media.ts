import { ffmpeg } from '../capture.js';

/** Every pane is scaled to this height before panes sit side by side, so a phone and a desktop line up. */
export const PANE_HEIGHT = 720;
const H264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '27', '-movflags', '+faststart'];

/** Playwright's WebM recording as a phone-playable MP4. */
export function mp4Args(webm: string, out: string): string[] {
  return ['-i', webm, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', ...H264, out];
}

/** A 10 fps, 480 px wide GIF with its own palette. */
export function gifArgs(video: string, out: string): string[] {
  return [
    '-i',
    video,
    '-vf',
    'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse',
    out,
  ];
}

/** Inputs side by side at one height: a tiled still for images, a stacked clip (shortest input wins) for videos. */
export function sideBySideArgs(inputs: string[], out: string, video: boolean): string[] {
  const scaled = inputs.map((_, i) => `[${i}:v]scale=-2:${PANE_HEIGHT}[p${i}]`).join(';');
  const panes = inputs.map((_, i) => `[p${i}]`).join('');
  const filter =
    inputs.length === 1
      ? `[0:v]scale=-2:${PANE_HEIGHT}`
      : `${scaled};${panes}hstack=inputs=${inputs.length}${video ? ':shortest=1' : ''}`;
  return [
    ...inputs.flatMap((input) => ['-i', input]),
    '-filter_complex',
    filter,
    ...(video ? H264 : ['-frames:v', '1']),
    out,
  ];
}

export function encodeGif(video: string, gif: string, binary = 'ffmpeg'): void {
  ffmpeg(binary, gifArgs(video, gif));
}

export function encodeClip(webm: string, mp4: string, gif: string, binary = 'ffmpeg'): void {
  ffmpeg(binary, mp4Args(webm, mp4));
  encodeGif(mp4, gif, binary);
}

export function sideBySide(inputs: string[], out: string, video: boolean, binary = 'ffmpeg'): void {
  if (inputs.length === 0) throw new Error('nothing to put side by side');
  ffmpeg(binary, sideBySideArgs(inputs, out, video));
}
