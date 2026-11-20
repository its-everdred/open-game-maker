/** A pack fact and how it was measured. */
export interface Fact<T> {
  value: T;
  verified: string;
}

export const DIRECTIONS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type Layer = 'floor' | 'wall' | 'roof' | 'decor';

const angles: Fact<Record<Direction, number>> = {
  value: { E: 0, NE: 45, N: 90, NW: 135, W: 180, SW: 225, S: 270, SE: 315 },
  verified:
    'frame file names carry the angle in degrees, counter-clockwise from east on screen: Walk_0_* under E/, ' +
    'Walk_135_* under NW/, Walk_270_* under S/ (2D HD Character Pack 1, 2026-11-01)',
};

const sheetRowOrder: Fact<readonly Direction[]> = {
  value: ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'],
  verified:
    'each sheet row compared pixel by pixel with the angle-named per-frame files (mean error 0 for all 8 rows and ' +
    '15 columns) on an HD 128 px humanoid Walk and Run and a 64 px animal Walk; labelled still rendered ' +
    'locally (path in the PR that added this file)',
};

const sheetGrid: Fact<{ cols: number; rows: number }> = {
  value: { cols: 15, rows: 8 },
  verified: 'every sheet is 15 frames across, one row per direction; columns are frames 0-14 in order (pixel match)',
};

const framesPerAction: Fact<number> = {
  value: 15,
  verified: 'Idle, Die, Melee, Run and every other action sheet hold exactly 15 columns',
};

const frameSizes: Fact<Record<'hd' | 'bit16', { frame: number; sheet: [number, number] }>> = {
  value: { hd: { frame: 128, sheet: [1920, 1024] }, bit16: { frame: 64, sheet: [960, 512] } },
  verified:
    'PNG headers of HD and 16-bit sheets (1920x1024 and 960x512); cards also carry 74-192 px and 14- or 8-column ' +
    'sheets, so the actor reads geometry from the card',
};

const variants: Fact<readonly ['shadow', 'shadowless']> = {
  value: ['shadow', 'shadowless'],
  verified: 'Spritesheets/With shadow(s)/<Action>.png and Spritesheets/Shadowless/<Action>_Shadowless.png',
};

const humanoidActions: Fact<readonly string[]> = {
  value: [
    '180Turn',
    'CastSpell',
    'CrouchIdle',
    'CrouchRun',
    'Die',
    'FrontFlip',
    'Idle',
    'Idle2',
    'Kick',
    'Melee',
    'Melee2',
    'MeleeRun',
    'MeleeSpin',
    'Pummel',
    'Rolling',
    'Run',
    'RunBackwards',
    'ShieldBlockMid',
    'ShieldBlockStart',
    'Slide',
    'SlideEnd',
    'SlideStart',
    'Special1',
    'Special2',
    'StrafeLeft',
    'StrafeRight',
    'TakeDamage',
    'UnSheathSword',
    'Walk',
  ],
  verified: 'sheet file names of the humanoid character packs (29 per character)',
};

const animalActions: Fact<readonly string[]> = {
  value: ['Attack1', 'Attack2', 'Attack3', 'Die', 'Idle', 'Idle2', 'Run', 'TakeDamage', 'Taunt', 'Walk'],
  verified: 'sheet file names of 2D Animals Mega Pack 1 (10 per species)',
};

const tile: Fact<{ piece: { widths: [number, number]; height: number }; footprint: [number, number] }> = {
  value: { piece: { widths: [128, 256], height: 256 }, footprint: [128, 64] },
  verified:
    'Measured ground PNG alpha bounds: 128x64 top face centered at y=208; images are 128x256 or 256x256 (sprite-pipeline report §2.1)',
};

const facingSuffixes: Fact<Record<'E' | 'N' | 'S' | 'W', string>> = {
  value: { E: '_E', N: '_N', S: '_S', W: '_W' },
  verified: 'tileset piece file names end in _E, _N, _S or _W',
};

const categoryLayers: Fact<Record<string, Layer>> = {
  value: { Ground: 'floor', Wall: 'wall', Door: 'wall', Roof: 'roof' },
  verified: 'tileset categories from the Environment/ file names; every other category is decor',
};

export const conventions = {
  angles,
  sheetRowOrder,
  sheetGrid,
  framesPerAction,
  frameSizes,
  variants,
  humanoidActions,
  animalActions,
  tile,
  facingSuffixes,
  categoryLayers,
} as const;

export function layerForCategory(category: string): Layer {
  return categoryLayers.value[category] ?? 'decor';
}
