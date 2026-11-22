/** A 3x3 pixel leaf, white so a palette tint colours it; drawn with nearest sampling. */
const LEAF = ['.##', '###', '##.'];
export const LEAF_SIZE = 3;
/** The soft mote's texture size: a white radial falloff, drawn with linear sampling. */
export const MOTE_SIZE = 16;

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const result = document.createElement('canvas');
  result.width = result.height = size;
  const context = result.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  return [result, context];
}

export function leafCanvas(): HTMLCanvasElement {
  const [result, context] = canvas(LEAF_SIZE);
  context.fillStyle = '#ffffff';
  LEAF.forEach((row, y) => [...row].forEach((cell, x) => cell === '#' && context.fillRect(x, y, 1, 1)));
  return result;
}

export function moteCanvas(): HTMLCanvasElement {
  const [result, context] = canvas(MOTE_SIZE);
  const half = MOTE_SIZE / 2;
  const glow = context.createRadialGradient(half, half, 0, half, half, half);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, MOTE_SIZE, MOTE_SIZE);
  return result;
}
