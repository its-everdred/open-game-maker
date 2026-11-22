import type { PieceKey } from './clearing.js';

/** Every texture the clearing draws: the pieces plus the hero's 15x8 idle sheet (128 px frames). */
export const TEXTURES: ReadonlyArray<PieceKey | 'hero-idle'> = [
  'ground-a1',
  'ground-a2',
  'ground-a6',
  'ground-a8',
  'tree-a1',
  'tree-a2',
  'tree-a3',
  'tree-e4',
  'stone-a1',
  'stone-a3',
  'stone-a12',
  'fireplace',
  'hero-idle',
];

export const HERO_FRAME = 128;

/**
 * Stand-in shapes for builds without the licensed pack (published builds and CI): same sizes and anchors as the pack
 * art, so the layout, lighting and focus run identically.
 */
export function fallbackTexture(key: (typeof TEXTURES)[number]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const hero = key === 'hero-idle';
  canvas.width = hero ? HERO_FRAME * 15 : 256;
  canvas.height = hero ? HERO_FRAME * 8 : 256;
  const ctx = canvas.getContext('2d')!;
  const diamond = (color: string, lift = 0) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(128, 144 - lift);
    ctx.lineTo(192, 176 - lift);
    ctx.lineTo(128, 208 - lift);
    ctx.lineTo(64, 176 - lift);
    ctx.closePath();
    ctx.fill();
  };
  const blob = (x: number, y: number, rx: number, ry: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  if (hero) {
    for (let row = 0; row < 8; row += 1)
      for (let col = 0; col < 15; col += 1) {
        const x = col * HERO_FRAME + 64;
        const y = row * HERO_FRAME;
        blob(x, y + 100, 18, 6, 'rgba(0,0,0,0.4)');
        ctx.fillStyle = '#5b4636';
        ctx.fillRect(x - 10, y + 58, 20, 40);
        blob(x, y + 50, 10, 10, '#c9c3b5');
      }
  } else if (key === 'ground-a1') diamond('#7a5a35');
  else if (key === 'ground-a2') diamond('#4f7a32');
  else if (key === 'ground-a6' || key === 'ground-a8') blob(128, 176, 40, 16, '#4f7a32');
  else if (key.startsWith('tree-a')) {
    ctx.fillStyle = '#5a3d22';
    ctx.fillRect(120, 140, 16, 66);
    blob(128, 96, 62, 70, key === 'tree-a2' ? '#4b7d2c' : '#5b8f33');
    blob(110, 80, 30, 28, '#73a541');
  } else if (key === 'tree-e4') blob(128, 186, 40, 10, '#6a4a2a');
  else if (key.startsWith('stone')) blob(128, 182, 22, 16, '#8a8a82');
  else if (key === 'fireplace') {
    blob(128, 180, 30, 14, '#7c7a74');
    blob(128, 180, 18, 8, '#2a2420');
  }
  return canvas;
}
