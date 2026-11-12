import { ctx, isMuted, node, sfxBus } from './context';

// Effects posted by an embedded scene (the title town): played here, on the audio the tap unlocked, never the iframe's.
const extBufs = new Map<string, Promise<AudioBuffer | null>>();
const extLoops = new Map<string, { g: GainNode }>();
const sources = new Set<AudioBufferSourceNode>();
let generation = 0;

function track(source: AudioBufferSourceNode): void {
  sources.add(source);
  source.onended = () => {
    sources.delete(source);
    source.disconnect();
  };
}

function extLoad(url: string): Promise<AudioBuffer | null> {
  let buf = extBufs.get(url);
  if (!buf) {
    buf = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .catch(() => null);
    extBufs.set(url, buf);
  }
  return buf;
}

export function ext(url: string, vol: number, rate: number): void {
  if (ctx.state !== 'running' || isMuted()) return;
  const current = generation;
  void extLoad(url).then((b) => {
    if (!b || current !== generation) return;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    s.connect(node(sfxBus, vol));
    track(s);
    s.start();
  });
}

export function extLoop(url: string, gain: number): void {
  let l = extLoops.get(url);
  if (!l) {
    if (ctx.state !== 'running') return;
    const loop = (l = { g: node(sfxBus, 0) });
    extLoops.set(url, loop);
    const current = generation;
    void extLoad(url).then((b) => {
      if (!b || current !== generation) return;
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.connect(loop.g);
      track(s);
      s.start();
    });
  }
  l.g.gain.value = gain;
}

// the embedded scene went away
export function extSilence(): void {
  generation++;
  for (const source of sources) source.stop();
  sources.clear();
  for (const l of extLoops.values()) {
    l.g.gain.value = 0;
    l.g.disconnect();
  }
  extLoops.clear();
}
