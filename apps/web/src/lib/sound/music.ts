import { ctx, node, notify, ramp, musicBus, sfxBus } from './context';

// Swap a track by changing its file name: any file in public/art/music (tools/town.sh builds every Kenney Music Loops
// track there). A track with loop points plays its intro once, then loops between them (seconds, from each track's asset
// card). fallback plays when the file isn't there (for example, an explicit public-only build has no Sidetrax tracks).
export const MUSIC: Record<'title' | 'menu', { file: string; loop: [number, number]; fallback: string }> = {
  title: { file: 'underground', loop: [55.904, 133.898], fallback: 'space-cadet' },
  menu: { file: 'camelot', loop: [42.983, 119.329], fallback: 'mishief-stroll' },
};

type Track = { name: string; g: GainNode; stop?: () => void };

const files = new Map<string, Promise<AudioBuffer | null>>();
class MissingAssetError extends Error {}
const licensedMusic = new Set([MUSIC.title.file, MUSIC.menu.file]);
let missingLicensedMusicLogged = false;

export function load(dir: 'music' | 'sfx', name: string): Promise<AudioBuffer | null> {
  const key = `${dir}/${name}`;
  let file = files.get(key);
  if (!file) {
    file = fetch(`/art/${key}.mp3`)
      .then((r) => {
        if (!r.ok || !r.headers.get('content-type')?.toLowerCase().startsWith('audio/')) {
          throw new MissingAssetError();
        }
        return r.arrayBuffer();
      })
      .then((b) => ctx.decodeAudioData(b))
      .catch((e: unknown) => {
        if (dir === 'music' && licensedMusic.has(name) && e instanceof MissingAssetError) {
          if (!missingLicensedMusicLogged) {
            console.info('sound: licensed music unavailable; using built-in fallback');
            missingLicensedMusicLogged = true;
          }
        } else {
          console.warn('sound', key, e);
        }
        return null;
      });
    files.set(key, file);
  }
  return file;
}

// fetched and decoded at once (a suspended context can still decode), so the first tap plays it straight away
export const titleReady: Promise<AudioBuffer | null> = load('music', MUSIC.title.file);

function end(layer: Track, s: number): void {
  ramp(layer.g, 0, s);
  setTimeout(
    () => {
      layer.stop?.();
      layer.g.disconnect();
    },
    s * 1000 + 200,
  );
}

let track: Track | null = null;
const introDone = new Set<string>(); // tracks whose intro has played: coming back to them starts at the loop

async function playMusic(def: (typeof MUSIC)['title'] | null, fade: number): Promise<void> {
  const name = def?.file;
  if (track?.name === name) return;
  if (track) {
    end(track, fade);
    track = null;
  }
  if (!def || !name) return;
  const me: Track = (track = { name, g: node(musicBus, 0) });
  let buf = await load('music', name);
  let loop: [number, number] | null = def.loop;
  if (!buf) {
    buf = await load('music', def.fallback);
    loop = null;
  }
  if (track !== me || !buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  if (loop) [src.loopStart, src.loopEnd] = loop;
  src.connect(me.g);
  src.start(0, loop && introDone.has(name) ? loop[0] : 0);
  introDone.add(name);
  me.stop = () => src.stop();
  ramp(me.g, 1, fade);
}

let want: 'title' | 'menu' | 'off' = 'off';
export function set(next: 'title' | 'menu' | 'off', fade = 1.6): void {
  want = next;
  if (ctx.state !== 'running' && next !== 'off') return;
  void playMusic(next === 'off' ? null : MUSIC[next], fade);
}

export function cue(name: string, vol = 0.6): void {
  if (ctx.state !== 'running') return;
  void load('sfx', name).then((b) => {
    if (!b) return;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(node(sfxBus, vol));
    s.start();
  });
}

// what should be playing is applied again whenever the browser lets audio run
ctx.addEventListener('statechange', () => {
  if (ctx.state === 'running') set(want, 0.8);
  notify();
});
