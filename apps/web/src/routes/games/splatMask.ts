const names = ['00', '01', '02', '03', '05', '07', '10', '11', '14', '16', '17', '18', '19', '20', '21', '24', '27', '28', '29', '30', '31', '33', '34', '35'];
let images: Promise<HTMLImageElement[]> | undefined;
const masks = new Map<string, Promise<string | undefined>>();

function loadSplats(): Promise<HTMLImageElement[]> {
  return (images ??= Promise.all(names.map((name) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Splat asset unavailable'));
    image.src = `/proto/art/splats/splat${name}.png`;
  }))));
}

// Reproduce the prototype's seeded paint stamps so every game's frame stays stable across renders.
export function splatMask(id: string): Promise<string | undefined> {
  const existing = masks.get(id);
  if (existing) return existing;
  const result = loadSplats().then((splats) => {
    const canvas = document.createElement('canvas');
    const width = 1600, height = 900, ix = width * 0.055, iy = height * 0.095;
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let seed = [...id].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 2147483647, 7) || 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const stamp = (image: HTMLImageElement, x: number, y: number, size: number, rotation: number) => {
      context.save(); context.translate(x, y); context.rotate(rotation); context.drawImage(image, -size / 2, -size / 2, size, size); context.restore();
    };
    const points: Array<[number, number, number, number]> = [];
    for (let d = 0; d < width - 2 * ix; d += 38) points.push([ix + d, iy, 0, -1], [width - ix - d, height - iy, 0, 1]);
    for (let d = 0; d < height - 2 * iy; d += 38) points.push([width - ix, iy + d, 1, 0], [ix, height - iy - d, -1, 0]);
    const sprayPoints: Array<[number, number, number, number]> = [];
    for (let d = 0; d < width - 2 * ix; d += 40) sprayPoints.push([ix + d, iy, 0, -1], [width - ix - d, height - iy, 0, 1]);
    for (let d = 0; d < height - 2 * iy; d += 40) sprayPoints.push([width - ix, iy + d, 1, 0], [ix, height - iy - d, -1, 0]);
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mask-fill').trim();
    context.beginPath(); context.roundRect(ix + 34, iy + 34, width - 2 * ix - 68, height - 2 * iy - 68, 20); context.fill();
    for (const [x, y, nx, ny] of points) {
      const image = splats[Math.floor(random() * splats.length)]!;
      const size = Math.min(2 * (Math.min(ix, iy) - 8), 100 + random() * 60);
      const offset = (random() - 0.5) * 12;
      stamp(image, x + nx * offset, y + ny * offset, size, random() * 7);
      stamp(splats[Math.floor(random() * splats.length)]!, x - nx * 30, y - ny * 30, 90, random() * 7);
    }
    const spray = [2, 12, 13, 18].map((index) => splats[index]!);
    for (let i = 0; i < 70; i += 1) {
      const [x, y, nx, ny] = sprayPoints[Math.floor(random() * sprayPoints.length)]!;
      const distance = 50 + random() * Math.min(ix, iy) * 0.35;
      stamp(spray[Math.floor(random() * spray.length)]!, Math.min(width - 16, Math.max(16, x + nx * distance)), Math.min(height - 16, Math.max(16, y + ny * distance)), 8 + random() * 18, random() * 7);
    }
    return canvas.toDataURL();
  }).catch(() => {
    images = undefined;
    masks.delete(id);
    return undefined;
  });
  masks.set(id, result);
  return result;
}
