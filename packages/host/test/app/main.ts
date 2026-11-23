import { createGameFrame, type GameFrame } from '@gm/host';
import type { GameManifest } from '@ogm/contracts/game';

interface BrowserHost {
  frame: GameFrame;
  ready: GameManifest[];
  relays: unknown[];
  errors: unknown[];
  forge(): void;
}

declare global {
  interface Window {
    __host: BrowserHost;
  }
}

const ready: GameManifest[] = [];
const relays: unknown[] = [];
const errors: unknown[] = [];
const template = new URLSearchParams(location.search).get('template');
const game =
  template === 'game-2d' || template === 'game-3d'
    ? {
        build: template === 'game-2d' ? ('published' as const) : ('test' as const),
        buildId: 'b1',
        gameId: template,
        mode: 'test' as const,
      }
    : {
        build: 'draft' as const,
        buildId: 'draft-1',
        gameId: template === 'menu' ? 'menu-game' : 'fixture',
        mode: 'play' as const,
      };
const frame = createGameFrame({
  container: document.querySelector<HTMLElement>('#game')!,
  gamesOrigin: 'http://127.0.0.1:4174',
  gameId: game.gameId,
  buildId: game.buildId,
  build: game.build,
  mode: game.mode,
  playerIndex: 0,
  capabilities: [],
  // The menu game keeps the host's default pad layout, the one its menus read.
  inputMapping:
    template === 'menu' ? undefined : { touch: 'stick', gamepad: { move: 'leftStick', jump: 'a', use: 'x' } },
  role: () => 'owner',
  onReady: (manifest) => ready.push(manifest),
  onAudioRelay: (payload) => relays.push(payload),
  onError: (failure) => errors.push(failure),
});

window.__host = {
  frame,
  ready,
  relays,
  errors,
  forge: () => {
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    iframe.src = 'http://127.0.0.1:4174/forger.html';
    document.body.append(iframe);
  },
};
