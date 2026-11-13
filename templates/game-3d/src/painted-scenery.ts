import { drawPaintedScenery, type PaintedImage } from '@gm/sdk/scenery';
import type { Scenery } from '@ogm/contracts/scenery';
import { CanvasTexture, SRGBColorSpace, type Scene } from 'three';

/** A screen-space painted layer behind a Three.js game's normal scene. */
export function createPaintedBackground(scene: Scene, resolve: (id: string) => string) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas unavailable');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const original = scene.background;
  const images = new Map<string, Promise<PaintedImage>>();
  let data: Scenery | undefined;
  let loaded = new Map<string, PaintedImage>();
  let generation = 0;
  let disposed = false;
  let offsetX = 0,
    offsetY = 0;
  let drawn = false;
  let aspect: number | undefined;
  const viewport = () => {
    const base = data?.viewport ?? { width: 640, height: 480 };
    return { width: aspect ? base.height * aspect : base.width, height: base.height };
  };
  const load = (id: string) => {
    let pending = images.get(id);
    if (!pending) {
      pending = new Promise<PaintedImage>((ok, fail) => {
        const image = new Image();
        image.onload = () => ok({ image, width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => fail(new Error(`scenery image unavailable: ${id}`));
        image.src = resolve(id);
      });
      images.set(id, pending);
      void pending.catch(() => {
        if (images.get(id) === pending) images.delete(id);
      });
    }
    return pending;
  };
  const draw = (cameraX = 0, cameraY = 0) => {
    if (!data) return;
    if (drawn && cameraX === offsetX && cameraY === offsetY) return;
    offsetX = cameraX;
    offsetY = cameraY;
    drawn = true;
    const view = viewport();
    canvas.width = view.width;
    canvas.height = view.height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawPaintedScenery(context, data, loaded, { ...view, cameraX, cameraY });
    texture.needsUpdate = true;
  };
  return {
    async update(next: Scenery) {
      const request = ++generation;
      const ids = [
        ...new Set([...(next.backdrop ? [next.backdrop.assetId] : []), ...next.items.map((item) => item.assetId)]),
      ];
      const entries = await Promise.all(ids.map(async (id) => [id, await load(id)] as const));
      if (disposed || request !== generation) return;
      data = next;
      loaded = new Map(entries);
      drawn = false;
      draw(offsetX, offsetY);
      scene.background = texture;
    },
    draw,
    resize(width: number, height: number) {
      if (width <= 0 || height <= 0) return;
      aspect = width / height;
      drawn = false;
      draw(offsetX, offsetY);
    },
    pick(nx: number, ny: number): string[] {
      if (!data) return [];
      const view = viewport();
      const layers = { back: 0, mid: 1, front: 2 };
      return [...data.items]
        .sort((a, b) => layers[b.layer] - layers[a.layer] || b.position[2] - a.position[2])
        .flatMap((item) => {
          const image = loaded.get(item.assetId);
          if (!image) return [];
          const dx = nx * view.width - item.position[0] + offsetX * (item.parallax ?? 1);
          const dy = ny * view.height - item.position[1] + offsetY * (item.parallax ?? 1);
          const angle = -item.rotation[2];
          const x = (dx * Math.cos(angle) - dy * Math.sin(angle)) / item.scale[0];
          const y = (dx * Math.sin(angle) + dy * Math.cos(angle)) / item.scale[1];
          return Math.abs(x) <= image.width / 2 && Math.abs(y) <= image.height / 2 ? [item.id] : [];
        });
    },
    project(nx: number, ny: number): [number, number, number] {
      const view = viewport();
      return [nx * view.width + offsetX, ny * view.height + offsetY, 0];
    },
    viewport,
    position(id: string) {
      const item = data?.items.find((entry) => entry.id === id);
      return item
        ? ([
            item.position[0] - offsetX * (item.parallax ?? 1),
            item.position[1] - offsetY * (item.parallax ?? 1),
            item.position[2],
          ] as [number, number, number])
        : undefined;
    },
    clear() {
      generation++;
      data = undefined;
      if (scene.background === texture) scene.background = original;
    },
    dispose() {
      disposed = true;
      generation++;
      if (scene.background === texture) scene.background = original;
      texture.dispose();
      images.clear();
    },
  };
}
