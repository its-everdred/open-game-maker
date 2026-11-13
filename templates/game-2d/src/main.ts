import { boot, type BuildKind } from '@gm/sdk/core';
import { createAssetLoader, pickTier } from '@gm/sdk/assets';
import { defaultInputMapping } from '@gm/sdk/camera';

import { connectPhaserLifecycle, game, getGameContext } from './game.js';
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
  const loader = createAssetLoader({
    manifestUrl: new URL('assets/manifest.json', location.href).toString(),
    planUrl: new URL('assets/cache-plan.json', location.href).toString(),
    tier: pickTier(),
    send: runtime.send,
    channel: runtime.build,
  });
  await loader.prepare();
  getGameContext().sceneryAssets = loader;
  runtime.onStep((dt, frames) => getGameContext().advance(dt, frames));
  getGameContext().editing = () => runtime.mode === 'edit';

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
