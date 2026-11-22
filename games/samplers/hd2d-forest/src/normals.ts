/**
 * A starting-point normal map from a sprite's alpha: height is the blurred silhouette, so edges tilt outward and the
 * body faces the camera. Semi-transparent pixels (the pack's baked drop shadow) stay flat. Hand-painted maps replace
 * this per sprite when an artist provides them.
 */
export function normalsFromAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 3,
): Uint8ClampedArray<ArrayBuffer> {
  const solid = new Float32Array(width * height);
  for (let i = 0; i < solid.length; i += 1) solid[i] = alpha[i]! >= 200 ? 1 : 0;
  const blurred = boxBlur(boxBlur(solid, width, height, radius, 1, 0), width, height, radius, 0, 1);
  const out = new Uint8ClampedArray(width * height * 4);
  const at = (x: number, y: number) =>
    blurred[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      let nx = 0;
      let ny = 0;
      if (solid[i]) {
        nx = (at(x - 1, y) - at(x + 1, y)) * 2;
        // Image rows grow downward; normal-map green points up.
        ny = (at(x, y + 1) - at(x, y - 1)) * 2;
      }
      const length = Math.hypot(nx, ny, 1);
      out[i * 4] = Math.round(((nx / length) * 0.5 + 0.5) * 255);
      out[i * 4 + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255);
      out[i * 4 + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
      out[i * 4 + 3] = 255;
    }
  return out;
}

function boxBlur(
  input: Float32Array,
  width: number,
  height: number,
  radius: number,
  dx: number,
  dy: number,
): Float32Array {
  const out = new Float32Array(input.length);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = Math.min(width - 1, Math.max(0, x + k * dx));
        const sy = Math.min(height - 1, Math.max(0, y + k * dy));
        sum += input[sy * width + sx]!;
      }
      out[y * width + x] = sum / (radius * 2 + 1);
    }
  return out;
}

/** The normal map of an image as a canvas, ready for `lighting.setNormalMap`. */
export function normalCanvas(image: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const { width, height } = image;
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const context = source.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, width, height).data;
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = rgba[i * 4 + 3]!;
  const normals = normalsFromAlpha(alpha, width, height);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d')!.putImageData(new ImageData(normals, width, height), 0, 0);
  return out;
}
