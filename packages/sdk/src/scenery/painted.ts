import type { Scenery } from './data.js';

export interface PaintedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface PaintedViewport {
  width: number;
  height: number;
  /** Physical display aspect used to select landscape or portrait framing. */
  aspect?: number;
  /** World-space camera displacement in pixels. */
  cameraX?: number;
  cameraY?: number;
}

/** Compute the image rectangle for the active aspect, including anchor when cropped or letterboxed. */
export function backdropRect(
  backdrop: NonNullable<Scenery['backdrop']>,
  image: Pick<PaintedImage, 'width' | 'height'>,
  view: PaintedViewport,
) {
  const rule = (view.aspect ?? view.width / view.height) >= 1 ? backdrop.landscape : backdrop.portrait;
  const scale = (rule.fit === 'cover' ? Math.max : Math.min)(view.width / image.width, view.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (view.width - width) * rule.anchor[0], y: (view.height - height) * rule.anchor[1], width, height };
}

/** Draw a painted scene in pixels, from the backdrop through items sorted by depth. */
export function drawPaintedScenery(
  context: CanvasRenderingContext2D,
  scene: Scenery,
  images: ReadonlyMap<string, PaintedImage>,
  view: PaintedViewport,
): void {
  const backdrop = scene.backdrop && images.get(scene.backdrop.assetId);
  if (scene.backdrop && backdrop) {
    const rect = backdropRect(scene.backdrop, backdrop, view);
    context.drawImage(backdrop.image, rect.x, rect.y, rect.width, rect.height);
  }
  const layers = { back: 0, mid: 1, front: 2 };
  const items = [...scene.items].sort((a, b) => layers[a.layer] - layers[b.layer] || a.position[2] - b.position[2]);
  for (const item of items) {
    const sprite = images.get(item.assetId);
    if (!sprite) continue;
    const x = item.position[0] - (view.cameraX ?? 0) * (item.parallax ?? 1);
    const y = item.position[1] - (view.cameraY ?? 0) * (item.parallax ?? 1);
    context.save();
    context.translate(x, y);
    context.rotate(item.rotation[2]);
    context.scale(item.scale[0], item.scale[1]);
    context.drawImage(sprite.image, -sprite.width / 2, -sprite.height / 2, sprite.width, sprite.height);
    context.restore();
  }
}
