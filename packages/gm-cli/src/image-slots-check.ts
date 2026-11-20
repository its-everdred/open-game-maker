import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import { IMAGE_SLOTS, ImageSlots, contrastRatio, imageRules, type SlotId, type ViewportId } from '@ogm/contracts';
import sharp from 'sharp';

type Variant = { slot: SlotId; viewport: ViewportId; path: string; text?: { capHeight: number; color?: string; background?: string } };

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
  const required: Partial<Record<SlotId, Record<string, unknown>>> = {};
  const publicRoot = resolve(game, 'public');
  try {
    await realpath(publicRoot);
  } catch {
    // Missing public images will be reported by the per-file validation below.
  }
  const thumbnail = resolve(publicRoot, 'media/thumbnail.png');
  try {
    await realpath(thumbnail);
    required.tile = { mode: 'per-ratio', variants: Object.fromEntries(IMAGE_SLOTS.tile.viewports.map((v) => [v, 'media/thumbnail.png'])) };
  } catch {
    // A thumbnail is only a required slot when the game ships it.
  }
  if (typeof manifest.logo === 'string')
    required.logo = { mode: 'per-ratio', variants: Object.fromEntries(IMAGE_SLOTS.logo.viewports.map((v) => [v, manifest.logo])) };
  if (typeof manifest.loading === 'object' && manifest.loading !== null) {
    const loading = manifest.loading as Record<string, unknown>;
    const variants: Record<string, unknown> = {};
    if (typeof loading.portrait === 'string') variants['phone-portrait'] = loading.portrait;
    if (typeof loading.landscape === 'string') variants['phone-landscape'] = loading.landscape;
    required.loading = { mode: 'per-ratio', variants };
  }
  const errors: string[] = [];
  if (manifest.images && typeof manifest.images === 'object' && !Array.isArray(manifest.images)) {
    for (const [slot, value] of Object.entries(manifest.images)) {
      if (slot in IMAGE_SLOTS) required[slot as SlotId] = value as Record<string, unknown>;
      else errors.push(`gm.manifest.json: images.${slot} is not a known image slot`);
    }
  }
  const rules = imageRules(manifest as Parameters<typeof imageRules>[0]);
  const variants: Variant[] = [];
  for (const slot of Object.keys(required) as SlotId[]) {
    const parsed = ImageSlots.safeParse({ [slot]: required[slot] });
    if (!parsed.success) {
      errors.push(`gm.manifest.json: images.${slot} does not match the image slot contract`);
      continue;
    }
    const entry = parsed.data[slot]!;
    for (const viewport of IMAGE_SLOTS[slot].viewports) {
      const path = entry.mode === 'per-ratio' ? entry.variants[viewport] : entry.variants?.[viewport];
      if (!path) errors.push(`images.${slot}: missing variant for ${viewport}`);
      else variants.push({ slot, viewport, path, ...(entry.mode === 'per-ratio' && entry.text ? { text: entry.text } : {}) });
    }
    if (entry.mode === 'layered') {
      for (const layer of entry.layers) {
        for (const viewport of Object.keys(layer.anchors) as ViewportId[]) {
          const anchor = layer.anchors[viewport]!;
          const margin = rules.safeMargin;
          if (anchor.x < margin || anchor.y < margin || anchor.x + anchor.width > 1 - margin || anchor.y + anchor.width > 1 - margin)
            errors.push(`${layer.src}: images.${slot} ${viewport} anchor leaves the safe area`);
        }
        const viewports = Object.keys(layer.anchors) as ViewportId[];
        for (const viewport of viewports) variants.push({ slot, viewport, path: layer.src });
      }
      if (entry.plate) {
        for (const viewport of IMAGE_SLOTS[slot].viewports) variants.push({ slot, viewport, path: entry.plate });
      }
    }
  }
  for (const variant of variants) {
    const { path, slot, viewport } = variant;
    if (isAbsolute(path)) {
      errors.push(`${path}: images.${slot} ${viewport} must be inside public`);
      continue;
    }
    const file = resolve(publicRoot, path);
    if (!file.startsWith(publicRoot + sep)) {
      errors.push(`${path}: images.${slot} ${viewport} must be inside public`);
      continue;
    }
    try {
      const realRoot = await realpath(publicRoot);
      const realFile = await realpath(file);
      if (!realFile.startsWith(realRoot + sep)) {
        errors.push(`${path}: images.${slot} ${viewport} must be inside public`);
        continue;
      }
      const { width = 0, height = 0 } = await sharp(realFile).metadata();
      const display = IMAGE_SLOTS[slot].display[viewport];
      if (Math.abs(width / height / (display.width / display.height) - 1) > 0.01)
        errors.push(`${path}: ${slot} ${viewport} is ${width}:${height}, needs the ${display.width}:${display.height} display box`);
      if (viewport.startsWith('phone') && variant.text) {
        const capHeight = variant.text.capHeight * display.height;
        if (capHeight < rules.minTextPx) errors.push(`${path}: ${slot} ${viewport} text is ${capHeight}px tall, needs ${rules.minTextPx}px`);
        if (variant.text.color && variant.text.background && contrastRatio(variant.text.color, variant.text.background) < (capHeight >= 24 ? rules.minContrastLarge : rules.minContrastText))
          errors.push(`${path}: ${slot} ${viewport} text contrast is below the required ratio`);
      }
    } catch {
      errors.push(`${path}: ${slot} ${viewport} image is missing or unreadable`);
    }
  }
  return errors;
}
