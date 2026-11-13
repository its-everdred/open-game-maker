import {
  createPaintedBackground,
  createSceneryController,
  paintedSceneryControls,
  sceneryFromDesign,
  sceneryPalette,
  type SceneryPaletteItem,
} from '@gm/sdk/scenery';
import type { DesignDoc, GameManifest, TargetRef } from '@ogm/contracts/browser';
import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ScenerySource } from './api';
import { disposeModel } from './dispose-model';
import type { GameFrameController, GameFrameState } from './frame';
import { mountPaintedPreview } from './painted-preview';

/** A local diorama for a game that does not yet have a runnable build. */
export function mountSceneryPreview(
  container: HTMLElement,
  source: ScenerySource,
  initial: DesignDoc,
  onState: (state: GameFrameState) => void,
): GameFrameController {
  const imageIds = new Set(
    source.assets.filter((entry) => /\.(?:png|jpe?g|webp)$/i.test(entry.path)).map((entry) => entry.id),
  );
  const mixed = source.scene.dimension === '3d' || source.scene.items.some((item) => !imageIds.has(item.assetId));
  if (source.scene.backdrop && !mixed) return mountPaintedPreview(container, source, initial, onState);
  const items: SceneryPaletteItem[] = source.assets
    .filter((entry) => /\.(?:glb|gltf)$/i.test(entry.path))
    .map((entry) => {
      const name = (entry.id.split('/').at(-1) ?? entry.id).split('@')[0]!.replace(/[-_.]+/g, ' ');
      const category = /tree|bush|foliage/i.test(name)
        ? 'trees'
        : /rock|stone/i.test(name)
          ? 'rocks'
          : /water|stream|river/i.test(name)
            ? 'water'
            : 'props';
      return { assetId: entry.id, name, category, sha256: entry.sha256 };
    });
  const palette = sceneryPalette(items, source.assets);
  if (source.scene.backdrop) {
    palette.categories.push(
      { id: 'backdrops', label: 'Backdrops', kind: 'items' },
      { id: 'sprites', label: 'Items', kind: 'items' },
    );
    for (const asset of source.assets.filter((entry) => imageIds.has(entry.id))) {
      const label = asset.id.split('/').at(-1) ?? asset.id;
      palette.items.push({
        prefab: `scenery-backdrop:${asset.id}`,
        label,
        category: 'backdrops',
        thumbnail: asset.url,
      });
      palette.items.push({
        prefab: `scenery:${asset.id}`,
        label,
        category: 'sprites',
        thumbnail: asset.url,
        tag: 'painted-sprite',
      });
    }
  }
  const manifest: GameManifest = {
    id: 'scenery-preview',
    sdk: '*',
    title: 'Scenery',
    inputs: { actions: {} },
    presentation: { orientation: 'any', minLogical: { w: 640, h: 360 }, fit: 'responsive' },
    view: 'fixed',
    dimension: '3d',
    capabilities: ['editor.project', 'scenery'],
    controls: source.scene.backdrop ? paintedSceneryControls : [],
    palette,
    tools: ['select', 'place'],
    gizmos: Object.fromEntries(palette.items.map((item) => [item.prefab, ['translate', 'rotateYaw']])),
    saves: false,
    overrides: { aliases: {}, retired: [] },
  };
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.append(renderer.domElement);
  const scene = new Scene();
  const ground = new Mesh(new BoxGeometry(30, 0.05, 30), new MeshStandardMaterial({ color: 0x719557 }));
  ground.position.y = -0.04;
  scene.add(ground);
  const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  camera.position.fromArray(source.scene.camera.position);
  camera.zoom = source.scene.camera.zoom;
  camera.lookAt(...source.scene.camera.target);
  const raycaster = new Raycaster();
  const plane = new Plane(new Vector3(0, 1, 0), 0);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const urls = new Map(source.assets.map((asset) => [asset.id, asset.url]));
  const painted = source.scene.backdrop
    ? createPaintedBackground(scene, (id) => {
        const url = urls.get(id);
        if (!url) throw new Error('asset unavailable');
        return url;
      })
    : undefined;
  const models = new Map<string, ReturnType<GLTFLoader['loadAsync']>>();
  const scenery = createSceneryController({
    parent: scene,
    loadAsset: async (id) => {
      const url = urls.get(id);
      if (!url) throw new Error('asset unavailable');
      let model = models.get(id);
      if (!model) {
        model = loader.loadAsync(url);
        models.set(id, model);
      }
      return (await model).scene.clone(true);
    },
  });
  const picked = new Set<(targets: TargetRef[]) => void>();
  const screens = new Set<(position: { id: string; x: number; y: number } | { id: string; offscreen: true }) => void>();
  let doc = initial;
  let disposed = false;
  let revision = 0;
  const draw = () => {
    if (!disposed) renderer.render(scene, camera);
  };
  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camera.left = -10 * aspect;
    camera.right = 10 * aspect;
    camera.top = 10;
    camera.bottom = -10;
    camera.updateProjectionMatrix();
    painted?.resize(width, height);
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const update = async (next: DesignDoc) => {
    const current = ++revision;
    doc = next;
    const data = 'scenery.settings' in next.globals ? sceneryFromDesign(next, source.assets) : source.scene;
    try {
      await scenery.update(
        painted ? { ...data, items: data.items.filter((item) => !imageIds.has(item.assetId)) } : data,
      );
      if (disposed || current !== revision) return;
      if (painted) await painted.update({ ...data, items: data.items.filter((item) => imageIds.has(item.assetId)) });
    } catch (error) {
      if (disposed || current !== revision) return;
      throw error;
    }
    if (disposed || current !== revision) return;
    painted?.resize(container.clientWidth, container.clientHeight);
    const ids = new Map(
      Object.values(doc.entities)
        .filter((entity) => entity.prefab.startsWith('scenery:'))
        .map((entity) => [
          typeof entity.props.sceneryItemId === 'string' ? entity.props.sceneryItemId : entity.id,
          entity.id,
        ]),
    );
    const root = scene.children.find((child) => child.name === 'scenery');
    for (const child of root?.children ?? []) child.userData.entityId = ids.get(child.userData.sceneryId);
    renderer.domElement.dataset.sceneryItems = String(
      root?.children.filter((child) => child.userData.entityId).length ?? 0,
    );
    draw();
  };
  const ray = (x: number, y: number) => {
    raycaster.setFromCamera(new Vector2(x * 2 - 1, 1 - y * 2), camera);
  };
  const pick = (x: number, y: number): TargetRef[] => {
    ray(x, y);
    for (const hit of raycaster.intersectObjects(scene.children, true)) {
      let object = hit.object;
      while (object && !object.userData.entityId && object.parent) object = object.parent;
      if (typeof object.userData.entityId === 'string') return [{ kind: 'entity', id: object.userData.entityId }];
    }
    return (painted?.pick(x, y) ?? []).flatMap((item) => {
      const entity = Object.values(doc.entities).find((entry) => (entry.props.sceneryItemId ?? entry.id) === item);
      return entity ? [{ kind: 'entity' as const, id: entity.id }] : [];
    });
  };
  const state: GameFrameState = {
    bridgeState: 'ready',
    dropped: 0,
    manifest,
    load: { phase: 'ready', loaded: 1, total: 1, done: true },
  };
  resize();
  void update(initial)
    .then(() => {
      if (!disposed) onState(state);
    })
    .catch(() => {
      if (!disposed) onState({ bridgeState: 'error', dropped: 0 });
    });
  const noop = () => {};
  return {
    state: () => state,
    setMode: noop,
    setSettings: noop,
    applyDesign: (_rev, next) => {
      void update(next).catch(() => {
        if (!disposed) onState({ bridgeState: 'error', dropped: 0 });
      });
    },
    pick: (x, y) => {
      const targets = pick(x, y);
      for (const callback of picked) callback(targets);
    },
    pickAt: async (x, y) => pick(x, y),
    project: async (x, y, prefab) => {
      if (painted && prefab?.startsWith('scenery:') && imageIds.has(prefab.slice('scenery:'.length)))
        return painted.project(x, y);
      ray(x, y);
      const hit = raycaster.ray.intersectPlane(plane, new Vector3());
      return hit ? [hit.x, hit.y, hit.z] : null;
    },
    select: (ids) => {
      const entity = ids[0] && doc.entities[ids[0]];
      if (!entity) return;
      const pose = entity.props.pose as { position?: number[] } | undefined;
      if (!pose?.position || pose.position.length !== 3) return;
      if (painted && imageIds.has(entity.prefab.slice('scenery:'.length))) {
        const point = painted.screen(pose.position as [number, number, number]);
        for (const callback of screens)
          callback({ id: entity.id, x: point.x * container.clientWidth, y: point.y * container.clientHeight });
        return;
      }
      const p = new Vector3(...(pose.position as [number, number, number])).project(camera);
      for (const callback of screens)
        callback({
          id: entity.id,
          x: ((p.x + 1) * container.clientWidth) / 2,
          y: ((1 - p.y) * container.clientHeight) / 2,
        });
    },
    camera: noop,
    validatePlacement: async (prefab) =>
      urls.has(prefab.replace(/^scenery:/, '')) ? { ok: true } : { ok: false, reason: 'asset unavailable' },
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
      revision++;
      observer.disconnect();
      scenery.dispose();
      painted?.dispose();
      for (const model of models.values()) void model.then(({ scene }) => disposeModel(scene)).catch(() => undefined);
      models.clear();
      ground.geometry.dispose();
      ground.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
