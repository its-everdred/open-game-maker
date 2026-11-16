import { boot, type BuildKind } from '@gm/sdk/core';
import { defaultInputMapping } from '@gm/sdk/camera';

import { connectPhaserLifecycle, game, getGameContext, syncSeatTable } from './game.js';
import { installStandaloneHost } from './standalone.js';

declare const __GM_BUILD__: BuildKind;

const requestedBuild = new URLSearchParams(location.search).get('build');
const build: BuildKind = requestedBuild === 'published' ? 'published' : __GM_BUILD__;
installStandaloneHost(build);

async function main(): Promise<void> {
  const runtime = await boot(game, {
    hostOrigin: window.parent === window ? location.origin : undefined,
    build,
    headless: build === 'test',
  });
  runtime.hooks.ready = false;
  runtime.onStep((dt, frames) => getGameContext().advance(dt, frames));
  const followNet = () => {
    // `localSeat` is this client's seat and `null` for a spectator; a v1 host-mode client has no seat table and
    // keeps `localPlayerIndex`, which is the same number there.
    const seat = runtime.net.localSeat ?? runtime.net.localPlayerIndex;
    getGameContext().localPlayerIndex = seat;
  };
  followNet();
  runtime.onFrame(followNet);
  // A per-seat match learns who is playing from the seat table; each seat's avatar follows it. The table the room
  // already sent while the frame was booting is read once here, because that broadcast went out before this listener.
  const syncSeats = () => syncSeatTable(runtime.net.seats, runtime.net.localSeat);
  runtime.net.onSeats(syncSeats);
  syncSeats();

  const [{ bindLifecycle, createPhaserGame }, { Boot }, { Level }] = await Promise.all([
    import('@gm/sdk/phaser'),
    import('./scenes/Boot.js'),
    import('./scenes/Level.js'),
  ]);

  const wrapper = await createPhaserGame(runtime, {
    parent: document.body,
    presentation: game.manifest.presentation,
    scenes: [Boot, Level],
    test: build === 'test',
  });
  wrapper.game.canvas.setAttribute('data-gm-play-area', '');
  wrapper.game.canvas.setAttribute('data-gm-play-area-aspect', String(640 / 480));
  runtime.attachInput({
    canvas: wrapper.game.canvas,
    mapping: defaultInputMapping(game.manifest.view),
  });
  connectPhaserLifecycle(bindLifecycle(runtime, wrapper.game, 'level'));
  runtime.setRenderInfoProvider(wrapper.info);
  wrapper.renderOnce();
  runtime.hooks.ready = true;
}

void main();
