import { boot, RuntimeImpl } from '@gm/sdk/core';
import { createAssetLoader, pickTier } from '@gm/sdk/assets';
import { createRig, EditorCamera, RigSet, type ThreeCameraRig } from '@gm/sdk/camera';
import { createRenderer, type RendererHandle } from '@gm/sdk/three';
import { SDK_PROTOCOL } from '@ogm/contracts/bridge';
import { OrthographicCamera, type Camera } from 'three';

import { createGame, type GameSave, type LevelDesign } from './game.js';
import { createScene, type SceneHandle } from './scene.js';
import { attachScenery } from './scenery.js';

declare const __GM_BUILD__: 'draft' | 'test' | 'published';

function installStandaloneHost(): () => void {
  if (window.parent !== window) return () => undefined;
  let port: MessagePort | undefined;
  const onHello = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin || typeof event.data !== 'string') return;
    let message: { t?: string; payload?: { manifest?: unknown } };
    try {
      message = JSON.parse(event.data) as typeof message;
    } catch {
      return;
    }
    if (message.t !== 'hello' || !message.payload?.manifest) return;
    window.removeEventListener('message', onHello);
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = () => undefined;
    port.start();
    window.postMessage(
      JSON.stringify({
        v: 1,
        id: 'template-host-hello',
        t: 'hello',
        payload: { protocol: SDK_PROTOCOL, capabilities: [], mode: 'test', build: __GM_BUILD__, playerIndex: 0 },
      }),
      window.location.origin,
      [channel.port2],
    );
  };
  window.addEventListener('message', onHello);
  return () => {
    window.removeEventListener('message', onHello);
    port?.close();
  };
}

async function start() {
  document.documentElement.dataset.bootStage = 'handshake';
  const closeStandaloneHost = installStandaloneHost();
  let runtime: RuntimeImpl<LevelDesign, GameSave> | undefined;
  let rendererHandle: RendererHandle | undefined;
  let sceneHandle: SceneHandle | undefined;
  let cameraRigs: RigSet | undefined;
  let editorCamera: EditorCamera | undefined;
  let stopViewport: (() => void) | undefined;
  let stopPlayers: (() => void) | undefined;
  let stopScenery: (() => void) | undefined;
  let onWindowResize: (() => void) | undefined;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    closeStandaloneHost();
    stopViewport?.();
    stopPlayers?.();
    stopScenery?.();
    if (onWindowResize) window.removeEventListener('resize', onWindowResize);
    cameraRigs?.dispose();
    editorCamera?.dispose();
    sceneHandle?.dispose();
    rendererHandle?.dispose();
  };

  try {
    const controller = createGame();
    const tier = pickTier();
    runtime = (await boot(controller.module, {
      build: __GM_BUILD__,
      headless: true,
      hostOrigin: window.parent === window ? window.location.origin : undefined,
    })) as RuntimeImpl<LevelDesign, GameSave>;
    runtime.hooks.ready = false;
    const loader = createAssetLoader({
      manifestUrl: new URL('assets/manifest.json', location.href).toString(),
      planUrl: new URL('assets/cache-plan.json', location.href).toString(),
      tier,
      send: runtime.send,
      channel: runtime.build,
    });
    await loader.prepare();
    controller.setSceneryAssetValidator((id) => {
      try {
        loader.resolve(id);
        return true;
      } catch {
        return false;
      }
    });
    const isSceneryImage = (id: string) => {
      try {
        return /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(loader.resolve(id).url);
      } catch {
        return false;
      }
    };
    controller.setSceneryImageValidator(isSceneryImage);
    document.documentElement.dataset.bootStage = 'runtime';

    const canvas = document.querySelector<HTMLCanvasElement>('#game');
    if (!canvas) throw new Error('game canvas is missing');
    rendererHandle = createRenderer(canvas, {
      tier,
      preserveDrawingBuffer: __GM_BUILD__ === 'test',
      onContextLost: () => {
        runtime?.clock.pause();
        runtime?.instance.pause();
      },
    });
    sceneHandle = createScene(controller.design());
    loader.attachRenderer(rendererHandle.renderer);
    const scenery = attachScenery(sceneHandle.scene, loader, controller.design().globals['level.size']);
    const offDesign = controller.onDesignChange((design) => {
      void scenery.update(design).catch((error: unknown) => console.error('scenery update failed', error));
    });
    stopScenery = () => {
      offDesign();
      scenery.dispose();
    };
    await scenery.update(controller.design());
    cameraRigs = new RigSet(
      () =>
        createRig(controller.module.manifest.view, '3d', {
          three: {
            scene: sceneHandle!.scene,
            viewport: () => ({ width: canvas.width, height: canvas.height }),
          },
        }),
      undefined,
      runtime.localPlayerIndex,
    );
    const frameEditorCamera = (camera: OrthographicCamera) => {
      const aspect = canvas.height > 0 ? canvas.width / canvas.height : 1;
      const half = controller.design().globals['level.size'] * 0.85;
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
    };
    let appliedCamera = '';
    /* Edit mode obeys bridge `editor.camera` (follow tracks the target, free pans/zooms); otherwise the manifest rig. */
    const viewCamera = (): Camera => {
      const command = runtime?.mode === 'edit' ? (controller.camera() ?? { mode: 'free' as const }) : undefined;
      if (!command) {
        editorCamera?.dispose();
        editorCamera = undefined;
        appliedCamera = '';
        return (cameraRigs!.active as ThreeCameraRig).camera;
      }
      if (!editorCamera) {
        const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
        frameEditorCamera(camera);
        editorCamera = new EditorCamera({ camera, canvas, view: 'iso' });
      }
      const key = `${command.mode}:${command.target ?? ''}`;
      if (key !== appliedCamera) {
        const target = command.target;
        if (command.mode === 'follow') {
          const camera = editorCamera.camera as OrthographicCamera;
          camera.zoom = 1;
          camera.updateProjectionMatrix();
        }
        editorCamera.follow(
          command.mode === 'follow' ? { position: () => controller.followPosition(target) } : undefined,
        );
        appliedCamera = key;
      }
      editorCamera.update();
      return editorCamera.camera;
    };
    const attachedPlayers = new Set<number>();
    const attachPlayers = () => {
      for (const player of Object.values(controller.state().players)) {
        if (attachedPlayers.has(player.playerIndex)) continue;
        const id = player.id;
        cameraRigs?.attach(player.playerIndex, {
          position: () => controller.state().players[id]?.position ?? [0, 0, 0],
        });
        attachedPlayers.add(player.playerIndex);
      }
    };
    attachPlayers();
    sceneHandle.setCamera((cameraRigs.active as ThreeCameraRig).camera);
    runtime.attachInput({
      canvas,
      mapping: cameraRigs.active.inputMapping,
      mapFrame: (frame) => (cameraRigs?.for(frame.playerIndex) as ThreeCameraRig | undefined)?.mapInput(frame) ?? frame,
    });
    runtime.onStep((dt, frames) => {
      attachPlayers();
      cameraRigs?.update(dt, frames);
      if (cameraRigs) sceneHandle?.setCamera(viewCamera());
    });
    stopPlayers = runtime.onNet((type, payload) => {
      if (type !== 'net.players') return;
      const local = (payload as { local?: unknown }).local;
      if (typeof local === 'number') cameraRigs?.setLocalPlayerIndex(local);
    });
    controller.attachScene({
      pick: (x, y) => [...sceneHandle!.pick(x, y), ...(scenery.isPainted() ? scenery.pick(x, y) : [])],
      screenToWorld: (x, y, selected, prefab) =>
        scenery.isPainted() &&
        (prefab
          ? prefab.startsWith('scenery:') && isSceneryImage(prefab.slice('scenery:'.length))
          : !selected || scenery.screen(selected))
          ? scenery.project(x, y)
          : sceneHandle!.screenToWorld(x, y),
      worldToScreen: (id) => scenery.screen(id) ?? sceneHandle!.worldToScreen(id),
    });
    document.documentElement.dataset.bootStage = 'physics';
    await controller.attachPhysics(runtime);
    runtime.setRenderInfoProvider(rendererHandle.info);

    const resize = (width: number, height: number, dpr: number) => {
      rendererHandle?.resize(width, height, dpr);
      sceneHandle?.resize(width, height);
      scenery.resize(width, height);
      if (editorCamera) frameEditorCamera(editorCamera.camera as OrthographicCamera);
    };
    const viewport = runtime.host.viewport.current();
    resize(viewport.w || window.innerWidth, viewport.h || window.innerHeight, viewport.dpr || window.devicePixelRatio);
    stopViewport = runtime.host.viewport.onChange((next) => resize(next.w, next.h, next.dpr));
    onWindowResize = () => resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    window.addEventListener('resize', onWindowResize);

    runtime.onFrame(() => {
      sceneHandle?.setCamera(viewCamera());
      sceneHandle?.sync(controller.state());
      if (sceneHandle) scenery.draw(sceneHandle.camera.position.x, sceneHandle.camera.position.z);
      if (rendererHandle && sceneHandle) rendererHandle.renderer.render(sceneHandle.scene, sceneHandle.camera);
    });
    sceneHandle.sync(controller.state());
    const initialTick = runtime.clock.tick;
    cameraRigs.update(
      runtime.clock.dt,
      [...attachedPlayers].map((playerIndex) => ({
        playerIndex,
        tick: initialTick,
        source: 'keyboard' as const,
        actions: {},
      })),
    );
    document.documentElement.dataset.bootStage = 'compile';
    await rendererHandle.compile(sceneHandle.scene, sceneHandle.camera);
    runtime.render();
    runtime.hooks.ready = true;
    document.documentElement.dataset.bootStage = 'ready';
    if (__GM_BUILD__ !== 'test') runtime.startLiveLoop();
    runtime.addCleanup(cleanup);
  } catch (error) {
    try {
      runtime?.dispose();
    } catch {
      // Preserve the startup error; resource cleanup below remains best effort.
    }
    cleanup();
    throw error;
  }
}

void start().catch((error: unknown) => {
  document.documentElement.dataset.bootStage = `error:${String(error)}`;
  throw error;
});
