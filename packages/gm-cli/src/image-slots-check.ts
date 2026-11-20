import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import { IMAGE_SLOTS, ImageSlots, contrastRatio, imageRules, type SlotId, type ViewportId } from '@ogm/contracts';
import sharp from 'sharp';

type Variant = {
  slot: SlotId;
  viewport: ViewportId;
  path: string;
  text?: { capHeight: number; color?: string; background?: string };
};
type LayerSource = { slot: SlotId; path: string; anchors: Partial<Record<ViewportId, { x: number; y: number; width: number }>> };
const NUMERIC_EPSILON = 1e-12;

/** Validate creator-visible image variants against the shared viewport and legibility contract. */
export async function checkImageSlots(game: string): Promise<string[]> {
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await readFile(resolve(game, 'gm.manifest.json'), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid manifest');
    manifest = parsed as Record<string, unknown>;
  } catch {
    return ['gm.manifest.json: unable to read manifest'];
  }

  const errors: string[] = [];
  const declaredImages = manifest.images === undefined ? null : ImageSlots.safeParse(manifest.images);
  if (declaredImages && !declaredImages.success) {
    for (const issue of declaredImages.error.issues) {
      const path = issue.path.length > 0 ? `images.${issue.path.join('.')}` : 'images';
      errors.push(`gm.manifest.json: ${path} does not match the image slot contract`);
    }
  }

  const required: Partial<Record<SlotId, (typeof ImageSlots)['_output'][SlotId]>> = {};
  const publicRoot = resolve(game, 'public');
  const thumbnail = resolve(publicRoot, 'media/thumbnail.png');
  try {
    await realpath(thumbnail);
    required.tile = {
      mode: 'per-ratio',
      variants: Object.fromEntries(IMAGE_SLOTS.tile.viewports.map((viewport) => [viewport, 'media/thumbnail.png'])),
    };
  } catch {
    // A thumbnail slot is only required when the game ships the file.
  }
  if (typeof manifest.logo === 'string') {
    required.logo = {
      mode: 'per-ratio',
      variants: Object.fromEntries(IMAGE_SLOTS.logo.viewports.map((viewport) => [viewport, manifest.logo])),
    };
  }
  // Legacy loading fields keep their own source checks; viewport outputs belong to images.loading.
  if (typeof manifest.loading === 'object' && manifest.loading !== null && !Array.isArray(manifest.loading)) {
    required.loading = { mode: 'per-ratio', variants: {} };
  }
  if (declaredImages && declaredImages.success) Object.assign(required, declaredImages.data);

  const defaultRules = imageRules({});
  let rules = defaultRules;
  if (manifest.imageRules !== undefined) {
    if (typeof manifest.imageRules !== 'object' || manifest.imageRules === null || Array.isArray(manifest.imageRules)) {
      errors.push('gm.manifest.json: imageRules must be an object of numeric overrides');
    } else {
      const overrides: Partial<typeof defaultRules> = {};
      for (const [name, value] of Object.entries(manifest.imageRules as Record<string, unknown>)) {
        if (!Object.hasOwn(defaultRules, name)) {
          errors.push(`gm.manifest.json: imageRules.${name} is not a known rule`);
        } else if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`gm.manifest.json: imageRules.${name} must be a finite number`);
        } else if (value < 0 || (name === 'safeMargin' && value >= 0.5)) {
          errors.push(`gm.manifest.json: imageRules.${name} is outside its valid range`);
        } else {
          overrides[name as keyof typeof defaultRules] = value;
        }
      }
      rules = imageRules({ imageRules: overrides });
    }
  }
  const variants: Variant[] = [];
  const layerSources: LayerSource[] = [];
  for (const slot of Object.keys(required) as SlotId[]) {
    const entry = required[slot]!;
    const declaredViewports = Object.keys(entry.variants ?? {}) as ViewportId[];
    const viewports = [...new Set([...IMAGE_SLOTS[slot].viewports, ...declaredViewports])];
    const hasDefaultOutputs = entry.mode === 'layered' && entry.variants === undefined;
    for (const viewport of viewports) {
      const path = entry.variants?.[viewport] ?? (hasDefaultOutputs ? `media/slots/${slot}-${viewport}.png` : undefined);
      if (!path) errors.push(`images.${slot}: missing variant for ${viewport}`);
      else variants.push({ slot, viewport, path, ...(entry.mode === 'per-ratio' && entry.text ? { text: entry.text } : {}) });
    }
    if (entry.mode === 'layered') {
      for (const layer of entry.layers) layerSources.push({ slot, path: layer.src, anchors: layer.anchors });
      if (entry.plate) layerSources.push({ slot, path: entry.plate, anchors: {} });
    }
  }

  async function metadata(
    path: string,
    slot: SlotId,
    viewport?: ViewportId,
  ): Promise<{ width: number; height: number } | undefined> {
    const subject = viewport ? `${slot} ${viewport}` : slot;
    if (isAbsolute(path)) {
      errors.push(`${path}: images.${subject} must be inside public`);
      return undefined;
    }
    const file = resolve(publicRoot, path);
    if (!file.startsWith(publicRoot + sep)) {
      errors.push(`${path}: images.${subject} must be inside public`);
      return undefined;
    }
    try {
      const realRoot = await realpath(publicRoot);
      const realFile = await realpath(file);
      if (!realFile.startsWith(realRoot + sep)) {
        errors.push(`${path}: images.${subject} must be inside public`);
        return undefined;
      }
      const metadata = await sharp(realFile).metadata();
      const { width = 0, height = 0 } = metadata.autoOrient ?? metadata;
      if (width <= 0 || height <= 0) throw new Error('image has no dimensions');
      return { width, height };
    } catch {
      errors.push(`${path}: images.${subject} image is missing or unreadable`);
      return undefined;
    }
  }

  for (const variant of variants) {
    const dimensions = await metadata(variant.path, variant.slot, variant.viewport);
    if (!dimensions) continue;
    const { width, height } = dimensions;
    const display = IMAGE_SLOTS[variant.slot].display[variant.viewport];
    if (Math.abs(width / height / (display.width / display.height) - 1) > 0.01 + NUMERIC_EPSILON)
      errors.push(
        `${variant.path}: ${variant.slot} ${variant.viewport} is ${width}:${height}, needs the ${display.width}:${display.height} display box`,
      );
    if (variant.viewport.startsWith('phone') && variant.text) {
      const capHeight = variant.text.capHeight * display.height;
      if (capHeight < rules.minTextPx)
        errors.push(`${variant.path}: ${variant.slot} ${variant.viewport} text is ${capHeight}px tall, needs ${rules.minTextPx}px`);
      if (
        variant.text.color &&
        variant.text.background &&
        contrastRatio(variant.text.color, variant.text.background) <
          (capHeight >= 24 ? rules.minContrastLarge : rules.minContrastText)
      ) {
        errors.push(`${variant.path}: ${variant.slot} ${variant.viewport} text contrast is below the required ratio`);
      }
    }
  }

  for (const layer of layerSources) {
    const layerViewports = Object.keys(layer.anchors) as ViewportId[];
    const sourceViewport = layerViewports[0] ?? IMAGE_SLOTS[layer.slot].viewports[0];
    const dimensions = await metadata(layer.path, layer.slot, sourceViewport);
    if (!dimensions) continue;
    for (const [viewport, anchor] of Object.entries(layer.anchors) as [ViewportId, NonNullable<LayerSource['anchors'][ViewportId]>][]) {
      const display = IMAGE_SLOTS[layer.slot].display[viewport];
      const halfWidth = anchor.width / 2;
      const heightFraction = (anchor.width * display.width * dimensions.height) / (display.height * dimensions.width);
      const halfHeight = heightFraction / 2;
      const margin = rules.safeMargin;
      if (
        anchor.x - halfWidth < margin - NUMERIC_EPSILON ||
        anchor.x + halfWidth > 1 - margin + NUMERIC_EPSILON ||
        anchor.y - halfHeight < margin - NUMERIC_EPSILON ||
        anchor.y + halfHeight > 1 - margin + NUMERIC_EPSILON
      ) {
        errors.push(`${layer.path}: images.${layer.slot} ${viewport} anchor leaves the safe area`);
      }
    }
  }
  return errors;
}
