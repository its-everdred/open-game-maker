import type { Fact } from './conventions.js';
import type { TileFacing } from './map.js';

/** Inclusive alpha rectangle, in source PNG pixels. */
export type AlphaBounds = readonly [left: number, top: number, right: number, bottom: number];
export interface StructuralImageBounds {
  size: readonly [width: number, height: number];
  facings: Readonly<Record<TileFacing, AlphaBounds>>;
}

/** A visually inspected post style and approximate placement, not a measured connection socket. */
export const inspectedGatePost: Fact<{
  asset: string;
  facing: TileFacing;
  scale: number;
  placementOffset: { x: number; y: number };
}> = {
  value: {
    asset: 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/stone-a14@2026-11-01',
    facing: 'E',
    scale: 0.4,
    placementOffset: { x: 1, y: 1 },
  },
  verified:
    'Stone A14 alpha bounds scanned and its approximate scaled position inspected in a phone render; the fence connection is not verified (2026-11-26).',
};

/**
 * Pixel bounds only: these do not establish an origin, connection socket, or footprint.
 * The source images remain in the local pack and are not shipped with this data.
 */
export const structuralImageBounds: Fact<Readonly<Record<string, StructuralImageBounds>>> = {
  value: {
    't1:smallscaleint-2d-hd-zombie-rural-tileset/tiles/isometric-tiles/fence-b1@2026-11-01': {
      size: [128, 256],
      facings: { E: [0, 92, 81, 240], N: [47, 92, 127, 239], S: [0, 67, 79, 216], W: [46, 67, 127, 215] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-a6@2026-11-01': {
      size: [256, 256],
      facings: { E: [56, 70, 105, 218], N: [103, 93, 152, 242], S: [103, 46, 152, 195], W: [150, 69, 199, 219] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-a12@2026-11-01': {
      size: [256, 256],
      facings: { E: [63, 112, 193, 240], N: [63, 135, 193, 216], S: [62, 112, 193, 240], W: [63, 135, 193, 216] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-a14@2026-11-01': {
      size: [256, 256],
      facings: { E: [63, 112, 193, 240], N: [63, 135, 193, 239], S: [62, 112, 193, 240], W: [63, 135, 193, 240] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/roof-d1@2026-11-01': {
      size: [256, 256],
      facings: { E: [62, 92, 203, 239], N: [62, 124, 204, 207], S: [52, 93, 193, 239], W: [51, 124, 193, 207] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/roof-d5@2026-11-01': {
      size: [256, 256],
      facings: { E: [51, 139, 203, 239], N: [52, 139, 204, 239], S: [52, 140, 204, 239], W: [51, 140, 203, 239] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/door-c1@2026-11-01': {
      size: [256, 256],
      facings: { E: [71, 110, 127, 229], N: [128, 111, 184, 229], S: [81, 87, 139, 206], W: [116, 87, 174, 205] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-f2@2026-11-01': {
      size: [256, 256],
      facings: { E: [56, 72, 199, 245], N: [103, 49, 203, 243], S: [51, 47, 152, 243], W: [56, 48, 199, 219] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-f3@2026-11-01': {
      size: [256, 256],
      facings: { E: [103, 72, 199, 243], N: [103, 49, 199, 219], S: [56, 72, 152, 243], W: [56, 47, 152, 219] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-f4@2026-11-01': {
      size: [256, 256],
      facings: { E: [103, 70, 199, 243], N: [103, 47, 199, 219], S: [56, 70, 152, 243], W: [56, 47, 152, 219] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-c1@2026-11-01': {
      size: [256, 256],
      facings: { E: [112, 73, 194, 239], N: [110, 51, 192, 215], S: [63, 75, 145, 240], W: [61, 51, 144, 215] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-c2@2026-11-01': {
      size: [256, 256],
      facings: { E: [63, 73, 194, 240], N: [110, 51, 194, 239], S: [61, 51, 145, 240], W: [61, 51, 192, 215] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-c3@2026-11-01': {
      size: [256, 256],
      facings: { E: [116, 74, 188, 237], N: [113, 51, 186, 212], S: [68, 76, 142, 238], W: [67, 53, 139, 213] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-c4@2026-11-01': {
      size: [256, 256],
      facings: { E: [112, 73, 194, 239], N: [110, 51, 192, 215], S: [63, 75, 145, 240], W: [61, 51, 144, 215] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-b8@2026-11-01': {
      size: [256, 256],
      facings: { E: [102, 151, 193, 245], N: [102, 128, 197, 220], S: [52, 151, 143, 243], W: [56, 129, 143, 220] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-f1@2026-11-01': {
      size: [256, 256],
      facings: { E: [103, 72, 199, 243], N: [103, 49, 199, 219], S: [56, 72, 152, 243], W: [56, 47, 152, 219] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-f6@2026-11-01': {
      size: [256, 256],
      facings: { E: [107, 72, 194, 161], N: [108, 49, 195, 138], S: [60, 72, 147, 161], W: [61, 48, 148, 137] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/door-a1@2026-11-01': {
      size: [256, 256],
      facings: { E: [128, 115, 182, 228], N: [113, 91, 174, 212], S: [73, 114, 127, 228], W: [81, 91, 142, 212] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/roof-c5@2026-11-01': {
      size: [256, 256],
      facings: { E: [51, 139, 203, 239], N: [52, 139, 204, 239], S: [52, 140, 204, 239], W: [51, 140, 203, 239] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/ground-h8@2026-11-01': {
      size: [256, 256],
      facings: { E: [96, 181, 159, 229], N: [75, 192, 170, 224], S: [85, 192, 180, 224], W: [96, 187, 159, 235] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/ground-h1@2026-11-01': {
      size: [256, 256],
      facings: { E: [64, 176, 191, 240], N: [64, 176, 191, 240], S: [64, 176, 191, 240], W: [64, 176, 191, 240] },
    },
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/stone-a14@2026-11-01': {
      size: [256, 256],
      facings: { E: [69, 9, 174, 236], N: [69, 9, 174, 236], S: [69, 9, 174, 236], W: [70, 9, 174, 236] },
    },
  },
  verified:
    'Decoded each named source PNG with sharp and scanned every nonzero alpha pixel; bounds are inclusive (2026-11-21 to 2026-11-26).',
};

/** Grid edge occupied by the rural Fence B1 sprite for each facing. */
export const fenceB1Edges: Fact<Readonly<Record<TileFacing, 'xMin' | 'xMax' | 'yMin' | 'yMax'>>> = {
  value: { E: 'yMax', N: 'xMax', S: 'xMin', W: 'yMin' },
  verified:
    'Dusk Helm #24 edge placement, checked against all four source PNG alpha masks on 2026-11-21: ' +
    'at the 128x64 tile displacement, E/W overlap 627/623 pixels along x versus 232/239 along y; ' +
    'N/S overlap 565/562 along y versus 197/218 along x. Facing positions distinguish each pair.',
};

/** Grid edge occupied by the fantasy Wall F1 sprite for each facing. */
export const wallF1Edges: Fact<Readonly<Record<TileFacing, 'xMin' | 'xMax' | 'yMin' | 'yMax'>>> = {
  value: { E: 'xMax', N: 'yMin', S: 'yMax', W: 'xMin' },
  verified:
    'Source PNG alpha-mask overlap at a 128x64 tile displacement on 2026-11-21: ' +
    'N/S overlap 2436/2428 pixels along x versus 1530/1544 along y, ' +
    'E/W overlap 2395/2396 along y versus 1525/1534 along x. ' +
    'Facing positions and a local 3x2 wall-loop diagnostic distinguish each side.',
};

/** Grid edge occupied by the fantasy timber Wall C1 sprite for each facing. */
export const wallC1Edges: Fact<Readonly<Record<TileFacing, 'xMin' | 'xMax' | 'yMin' | 'yMax'>>> = {
  value: { E: 'xMax', N: 'yMin', S: 'yMax', W: 'xMin' },
  verified:
    'Source PNG alpha-mask overlap at a 128x64 tile displacement on 2026-11-21: ' +
    'N/S overlap 1688/1679 pixels along x versus 874/986 along y, ' +
    'E/W overlap 1535/1522 along y versus 878/818 along x. ' +
    'Facing positions and a local 3x2 timber wall-loop diagnostic distinguish each side.',
};

/** Grid edge occupied by the fantasy Wall F6 arch for each facing. */
export const wallF6Edges: Fact<Readonly<Record<TileFacing, 'xMin' | 'xMax' | 'yMin' | 'yMax'>>> = {
  value: { E: 'xMax', N: 'yMin', S: 'yMax', W: 'xMin' },
  verified:
    'Source PNG alpha-mask overlap at a 128x64 tile displacement on 2026-11-21: ' +
    'N/S overlap 809/795 pixels along x and zero along y; ' +
    'E/W overlap 780/772 along y and zero along x. ' +
    'Facing positions and the local stone-shell door diagnostic distinguish each side.',
};
