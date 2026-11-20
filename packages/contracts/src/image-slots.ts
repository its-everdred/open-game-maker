import { z } from 'zod';

export const VIEWPORTS = {
  'phone-portrait': { width: 390, height: 844 },
  'phone-landscape': { width: 844, height: 390 },
  'tablet-portrait': { width: 820, height: 1180 },
  'tablet-landscape': { width: 1180, height: 820 },
  desktop: { width: 1920, height: 1080 },
} as const;

export type ViewportId = keyof typeof VIEWPORTS;
export const VIEWPORT_IDS: readonly ViewportId[] = Object.keys(VIEWPORTS) as ViewportId[];
export const REVIEW_VIEWPORTS: readonly ViewportId[] = VIEWPORT_IDS.filter((id) => id !== 'desktop');

export const IMAGE_RULES: { safeMargin: number; minTextPx: number; minIconPx: number; minContrastText: number; minContrastLarge: number } = {
  safeMargin: 0.05,
  minTextPx: 16,
  minIconPx: 12,
  minContrastText: 4.5,
  minContrastLarge: 3,
};

export const SLOT_IDS = ['tile', 'logo', 'loading', 'title', 'store-icon', 'review-media', 'hud-panel', 'background'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

type DisplayBox = { width: number; height: number };
type ImageSlot = { viewports: readonly ViewportId[]; display: Record<ViewportId, DisplayBox> };

const allViewports = VIEWPORT_IDS;
const displayBoxes = (width: number, height: number): Record<ViewportId, DisplayBox> =>
  Object.fromEntries(VIEWPORT_IDS.map((id) => [id, { width, height }])) as Record<ViewportId, DisplayBox>;

// Display boxes follow Cover.tsx's responsive sizes; safe area is CSS env(safe-area-inset-*) plus safeMargin on each edge.
export const IMAGE_SLOTS: Record<SlotId, ImageSlot> = {
  // Cover.tsx uses 45vw through 600px, 25vw through 1000px and 240px above; tiles are 16:9 today.
  tile: { viewports: REVIEW_VIEWPORTS, display: { 'phone-portrait': { width: 175.5, height: 98.719 }, 'phone-landscape': { width: 211, height: 118.688 }, 'tablet-portrait': { width: 205, height: 115.313 }, 'tablet-landscape': { width: 240, height: 135 }, desktop: { width: 240, height: 135 } } },
  // gamesCache.ts preloads logos at 55vw on phones and 320px otherwise; logos are square image boxes.
  logo: { viewports: allViewports, display: { 'phone-portrait': { width: 214.5, height: 214.5 }, 'phone-landscape': { width: 320, height: 320 }, 'tablet-portrait': { width: 320, height: 320 }, 'tablet-landscape': { width: 320, height: 320 }, desktop: { width: 320, height: 320 } } },
  // Full viewport display boxes.
  loading: { viewports: allViewports, display: { ...VIEWPORTS } },
  // Full viewport display boxes.
  title: { viewports: allViewports, display: { ...VIEWPORTS } },
  // Store artwork is delivered at native viewport size.
  'store-icon': { viewports: allViewports, display: { ...displayBoxes(512, 512) } },
  // Review media is captured at the four review viewport sizes.
  'review-media': { viewports: REVIEW_VIEWPORTS, display: { ...VIEWPORTS } },
  // HUD panels are rendered against each viewport's CSS pixel dimensions.
  'hud-panel': { viewports: allViewports, display: { ...VIEWPORTS } },
  // Backgrounds fill each viewport.
  background: { viewports: allViewports, display: { ...VIEWPORTS } },
};

const mediaPath = z.string().regex(/^media\/[a-zA-Z0-9_/-]+\.(png|jpe?g|webp)$/);
const anchor = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1) }).strict();
const viewportAnchors = z.partialRecord(z.enum(VIEWPORT_IDS), anchor);

export const ImageSlotEntry = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('per-ratio'), variants: z.partialRecord(z.enum(VIEWPORT_IDS), mediaPath), text: z.object({ capHeight: z.number().positive().max(1), color: z.string().regex(/^#[\da-fA-F]{6}$/).optional(), background: z.string().regex(/^#[\da-fA-F]{6}$/).optional() }).strict().optional() }).strict(),
  z.object({ mode: z.literal('layered'), plate: mediaPath.optional(), layers: z.array(z.object({ src: mediaPath, anchors: viewportAnchors }).strict()), variants: z.partialRecord(z.enum(VIEWPORT_IDS), mediaPath).optional() }).strict(),
]);

export const ImageSlots = z.partialRecord(z.enum(SLOT_IDS), ImageSlotEntry);

export function imageRules(manifest: { imageRules?: Partial<typeof IMAGE_RULES> }): typeof IMAGE_RULES {
  return { ...IMAGE_RULES, ...manifest.imageRules };
}

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/.{2}/g);
  if (!rgb) throw new Error(`invalid hex color: ${hex}`);
  const [r, g, b] = rgb.map((part) => parseInt(part, 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  if (!/^#[\da-fA-F]{6}$/.test(a) || !/^#[\da-fA-F]{6}$/.test(b)) throw new Error('colors must be six-digit hex values');
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}
