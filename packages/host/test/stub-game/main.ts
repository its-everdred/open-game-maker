import { SDK_PROTOCOL, gameToHostSchema, hostToGameSchema, type Envelope } from '@ogm/contracts/bridge';
import type { GameManifest } from '@ogm/contracts/game';
import { openGameBridge } from '@ogm/iframe-bridge';

declare global {
  interface Window {
    __frames: unknown[];
    __hostMessages: unknown[];
    __taps: number;
    __cacheReady: Promise<ServiceWorkerRegistration | undefined>;
    __cacheResult: Promise<string>;
  }
}

const manifest: GameManifest = {
  id: 'browser-fixture',
  sdk: '^1.0.0',
  title: 'Browser Fixture',
  inputs: { actions: { move: 'stick', jump: 'button', use: 'button' } },
  presentation: { orientation: 'landscape', minLogical: { w: 640, h: 360 }, fit: 'responsive' },
  view: 'iso',
  dimension: '3d',
  capabilities: [],
  palette: { categories: [], items: [] },
  tools: [],
  gizmos: {},
  saves: false,
  overrides: { aliases: {}, retired: [] },
};

window.__frames = [];
window.__hostMessages = [];
window.__taps = 0;
window.__cacheReady = 'serviceWorker' in navigator ? navigator.serviceWorker.ready : Promise.resolve(undefined);
window.__cacheResult = window.__cacheReady
  .then(() => fetch(`/a/${'a'.repeat(64)}.glb`))
  .then((response) => response.text())
  .then((result) => {
    const output = document.querySelector('#cache-result');
    if (output) output.textContent = result;
    return result;
  });

const bridge = openGameBridge({
  hostOrigin: 'http://127.0.0.1:4173',
  helloPayload: { protocol: SDK_PROTOCOL },
  validate: (raw) => {
    const parsed = hostToGameSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
  onMessage: (message) => {
    window.__hostMessages.push(message);
    if (message.t === 'hello') {
      const ready: Envelope<'ready', unknown> = {
        v: 1,
        id: 'ready-1',
        t: 'ready',
        payload: { protocol: SDK_PROTOCOL, manifest, marks: [['fixture-ready', performance.now()]] },
      };
      const parsed = gameToHostSchema.parse(ready);
      bridge.send(parsed);
      /* Its canvas is up from the start; a published game gets this from the games host's frame observer. */
      bridge.send(gameToHostSchema.parse({ v: 1, id: 'frame-1', t: 'load.frame', payload: {} }));
    }
    if (message.t === 'input.frame') window.__frames.push(message.payload);
  },
});

document.querySelector('#relay')?.addEventListener('click', () => {
  bridge.send(
    gameToHostSchema.parse({
      v: 1,
      id: 'audio-1',
      t: 'audio.relay',
      payload: { cue: 'jump', vol: 0.5, rate: 1 },
    }),
  );
});

document.querySelector('#canvas')?.addEventListener('click', () => {
  window.__taps += 1;
});
