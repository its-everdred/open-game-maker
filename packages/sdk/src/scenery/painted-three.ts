import { drawPaintedScenery, type PaintedImage } from './painted.js';
import type { Scenery } from './data.js';
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
  const viewport = () => data?.viewport ?? { width: 640, height: 480 };
  const framing = () => {
    const view = viewport();
    const surface = { width: aspect ? view.height * aspect : view.width, height: view.height };
    const scale = Math.min(surface.width / view.width, surface.height / view.height);
    return {
      ...surface,
      scale,
      x: (surface.width - view.width * scale) / 2,
      y: (surface.height - view.height * scale) / 2,
    };
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
    const frame = framing();
    canvas.width = frame.width;
    canvas.height = frame.height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(frame.scale, 0, 0, frame.scale, frame.x, frame.y);
    context.save();
    context.beginPath();
    context.rect(0, 0, view.width, view.height);
    context.clip();
    drawPaintedScenery(context, data, loaded, { ...view, ...(aspect ? { aspect } : {}), cameraX, cameraY });
    context.restore();
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
      const frame = framing();
      const view = viewport();
      const px = (nx * frame.width - frame.x) / frame.scale;
      const py = (ny * frame.height - frame.y) / frame.scale;
      if (px < 0 || py < 0 || px > view.width || py > view.height) return [];
      const layers = { back: 0, mid: 1, front: 2 };
      return [...data.items]
        .sort((a, b) => layers[b.layer] - layers[a.layer] || b.position[2] - a.position[2])
        .flatMap((item) => {
          const image = loaded.get(item.assetId);
          if (!image) return [];
          const dx = px - item.position[0] + offsetX * (item.parallax ?? 1);
          const dy = py - item.position[1] + offsetY * (item.parallax ?? 1);
          const angle = -item.rotation[2];
          const x = (dx * Math.cos(angle) - dy * Math.sin(angle)) / item.scale[0];
          const y = (dx * Math.sin(angle) + dy * Math.cos(angle)) / item.scale[1];
          return Math.abs(x) <= image.width / 2 && Math.abs(y) <= image.height / 2 ? [item.id] : [];
        });
    },
    project(nx: number, ny: number): [number, number, number] | null {
      const frame = framing();
      const x = (nx * frame.width - frame.x) / frame.scale;
      const y = (ny * frame.height - frame.y) / frame.scale;
      const view = viewport();
      return x < 0 || y < 0 || x > view.width || y > view.height ? null : [x + offsetX, y + offsetY, 0];
    },
    screen(position: [number, number, number]) {
      const frame = framing();
      return {
        x: (frame.x + position[0] * frame.scale) / frame.width,
        y: (frame.y + position[1] * frame.scale) / frame.height,
      };
    },
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
