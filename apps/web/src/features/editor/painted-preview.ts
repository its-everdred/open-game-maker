import { drawPaintedScenery, paintedSceneryControls, sceneryFromDesign, type PaintedImage } from '@gm/sdk/scenery';
import type { DesignDoc, GameManifest, TargetRef } from '@ogm/contracts/browser';
import type { Scenery } from '@ogm/contracts/scenery';
import type { ScenerySource } from './api';
import type { GameFrameController, GameFrameState } from './frame';

/** Editor preview for scenes built from images, before a runnable game exists. */
export function mountPaintedPreview(
  container: HTMLElement,
  source: ScenerySource,
  initial: DesignDoc,
  onState: (state: GameFrameState) => void,
): GameFrameController {
  const assets = source.assets.filter((asset) => /\.(png|jpe?g|webp)$/i.test(asset.path));
  const items = assets.map((asset) => ({
    prefab: `scenery:${asset.id}`,
    label: asset.id.split('/').at(-1) ?? asset.id,
    category: 'sprites',
    thumbnail: asset.url,
  }));
  const manifest: GameManifest = {
    id: 'painted-scenery-preview',
    sdk: '*',
    title: 'Scenery',
    inputs: { actions: {} },
    presentation: { orientation: 'any', minLogical: { w: 640, h: 360 }, fit: 'responsive' },
    view: 'fixed',
    dimension: '2d',
    capabilities: ['editor.project', 'scenery'],
    controls: paintedSceneryControls,
    palette: {
      categories: [
        { id: 'backdrops', label: 'Backdrops', kind: 'items' },
        { id: 'sprites', label: 'Items', kind: 'items' },
      ],
      items: [
        ...assets.map((asset) => ({
          prefab: `scenery-backdrop:${asset.id}`,
          label: asset.id.split('/').at(-1) ?? asset.id,
          category: 'backdrops',
          thumbnail: asset.url,
        })),
        ...items,
      ],
    },
    tools: ['select', 'place'],
    gizmos: Object.fromEntries(items.map((item) => [item.prefab, ['translate']])),
    saves: false,
    overrides: { aliases: {}, retired: [] },
  };
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.append(canvas);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas unavailable');
  const images = new Map<string, PaintedImage>();
  const picked = new Set<(targets: TargetRef[]) => void>();
  const screens = new Set<(position: { id: string; x: number; y: number } | { id: string; offscreen: true }) => void>();
  let doc = initial;
  let scene: Scenery = source.scene;
  let disposed = false;
  const dimensions = () => ({
    width: (360 * Math.max(1, container.clientWidth)) / Math.max(1, container.clientHeight),
    height: 360,
  });
  const draw = () => {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth),
      height = Math.max(1, container.clientHeight);
    canvas.width = width;
    canvas.height = height;
    const view = dimensions();
    context.setTransform(width / view.width, 0, 0, height / view.height, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    drawPaintedScenery(context, scene, images, view);
  };
  const update = (next: DesignDoc) => {
    doc = next;
    scene = 'scenery.settings' in next.globals ? sceneryFromDesign(next, source.assets) : source.scene;
    draw();
  };
  const resize = new ResizeObserver(draw);
  resize.observe(container);
  const state: GameFrameState = {
    bridgeState: 'ready',
    dropped: 0,
    manifest,
    load: { phase: 'ready', loaded: 1, total: 1, done: true },
  };
  void Promise.all(
    assets.map(
      (asset) =>
        new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            images.set(asset.id, { image, width: image.naturalWidth, height: image.naturalHeight });
            resolve();
          };
          image.onerror = () => reject(new Error('scenery image unavailable'));
          image.src = asset.url;
        }),
    ),
  )
    .then(() => {
      if (!disposed) {
        update(doc);
        onState(state);
      }
    })
    .catch(() => {
      if (!disposed) onState({ bridgeState: 'error', dropped: 0 });
    });
  const hit = (x: number, y: number): TargetRef[] => {
    const view = dimensions(),
      px = x * view.width,
      py = y * view.height;
    const layers = { back: 0, mid: 1, front: 2 };
    const ordered = [...scene.items].sort((a, b) => layers[b.layer] - layers[a.layer] || b.position[2] - a.position[2]);
    for (const item of ordered) {
      const image = images.get(item.assetId);
      if (!image) continue;
      const dx = px - item.position[0],
        dy = py - item.position[1],
        angle = -item.rotation[2];
      const localX = (dx * Math.cos(angle) - dy * Math.sin(angle)) / item.scale[0];
      const localY = (dx * Math.sin(angle) + dy * Math.cos(angle)) / item.scale[1];
      if (Math.abs(localX) > image.width / 2 || Math.abs(localY) > image.height / 2) continue;
      const entity = Object.values(doc.entities).find((entry) => (entry.props.sceneryItemId ?? entry.id) === item.id);
      if (entity) return [{ kind: 'entity', id: entity.id }];
    }
    return [];
  };
  const noop = () => {};
  return {
    state: () => state,
    setMode: noop,
    setSettings: noop,
    applyDesign: (_rev, next) => update(next),
    pick: (x, y) => {
      const targets = hit(x, y);
      for (const callback of picked) callback(targets);
    },
    pickAt: async (x, y) => hit(x, y),
    project: async (x, y) => {
      const view = dimensions();
      return [x * view.width, y * view.height, 0];
    },
    select: (ids) => {
      const pose = ids[0] ? (doc.entities[ids[0]]?.props.pose as { position?: number[] } | undefined) : undefined;
      if (!pose?.position) return;
      const view = dimensions();
      for (const callback of screens)
        callback({
          id: ids[0]!,
          x: (pose.position[0]! / view.width) * container.clientWidth,
          y: (pose.position[1]! / view.height) * container.clientHeight,
        });
    },
    camera: noop,
    validatePlacement: async (prefab) =>
      assets.some((asset) => prefab === `scenery:${asset.id}`)
        ? { ok: true }
        : { ok: false, reason: 'asset unavailable' },
    onPicked: (callback) => {
      picked.add(callback);
      return () => {
        picked.delete(callback);
      };
    },
    onScreen: (callback) => {
      screens.add(callback);
      return () => {
        screens.delete(callback);
      };
    },
    pause: noop,
    resume: noop,
    restoreSave: noop,
    onSaveLoadError: () => noop,
    sendRoomMessage: noop,
    onSaveWrite: () => noop,
    onEvent: () => noop,
    netInfo: async () => undefined,
    dispose: () => {
      disposed = true;
      resize.disconnect();
      canvas.remove();
    },
  };
}
