export interface TestArt {
  hero: HTMLCanvasElement;
  heroNormal: HTMLCanvasElement;
  tree: HTMLCanvasElement;
  trunk: HTMLCanvasElement;
  canopy: HTMLCanvasElement;
  leaves: HTMLCanvasElement;
  mote: HTMLCanvasElement;
}

function canvas(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  const ctx = result.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return result;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function createTestArt(seed: number): TestArt {
  const rand = random(seed);
  const hero = canvas(16, 24, (ctx) => {
    ctx.fillStyle = '#352d47';
    ctx.fillRect(5, 1, 7, 6);
    ctx.fillStyle = '#f0bd83';
    ctx.fillRect(6, 2, 5, 5);
    ctx.fillStyle = '#bd4d42';
    ctx.fillRect(4, 8, 9, 9);
    ctx.fillStyle = '#d9a34d';
    ctx.fillRect(5, 8, 7, 2);
    ctx.fillStyle = '#34465b';
    ctx.fillRect(4, 17, 4, 6);
    ctx.fillRect(10, 17, 4, 6);
    ctx.fillStyle = '#222b3a';
    ctx.fillRect(3, 22, 6, 2);
    ctx.fillRect(9, 22, 6, 2);
  });
  const heroNormal = canvas(hero.width, hero.height, (ctx) => {
    const pixels = ctx.createImageData(hero.width, hero.height);
    const source = hero.getContext('2d')!.getImageData(0, 0, hero.width, hero.height).data;
    for (let i = 0; i < source.length; i += 4) {
      const visible = source[i + 3] > 0;
      pixels.data[i] = 128;
      pixels.data[i + 1] = visible ? 188 : 128;
      pixels.data[i + 2] = 240;
      pixels.data[i + 3] = source[i + 3];
    }
    ctx.putImageData(pixels, 0, 0);
  });
  const trunk = canvas(96, 112, (ctx) => {
    ctx.fillStyle = '#53382c';
    ctx.fillRect(40, 30, 17, 82);
    ctx.fillRect(26, 50, 16, 8);
    ctx.fillRect(55, 43, 20, 8);
    ctx.fillStyle = '#79503a';
    ctx.fillRect(44, 35, 5, 77);
    ctx.fillStyle = '#392d2b';
    ctx.fillRect(37, 107, 28, 5);
  });
  const canopy = canvas(112, 72, (ctx) => {
    const blobs = [
      [30, 37, 24],
      [53, 22, 23],
      [78, 39, 25],
      [49, 48, 27],
      [90, 25, 16],
    ];
    blobs.forEach(([x, y, radius], index) => {
      ctx.fillStyle = ['#285b45', '#34704d', '#438251'][index % 3];
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = '#79a457';
    for (let i = 0; i < 28; i += 1) ctx.fillRect(18 + Math.floor(rand() * 76), 15 + Math.floor(rand() * 42), 3, 3);
  });
  const tree = canvas(128, 128, (ctx) => {
    ctx.drawImage(trunk, 16, 16, 96, 112);
    ctx.drawImage(canopy, 8, 5);
  });
  const leaves = canvas(64, 32, (ctx) => {
    const colors = ['#528b51', '#7ba75a', '#b7bd63', '#356a4c'];
    for (let i = 0; i < 32; i += 1) {
      ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
      ctx.fillRect((i % 8) * 8, Math.floor(i / 8) * 8, 4 + Math.floor(rand() * 4), 4 + Math.floor(rand() * 4));
    }
  });
  const mote = canvas(32, 32, (ctx) => {
    const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255,238,168,0.8)');
    gradient.addColorStop(1, 'rgba(255,238,168,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
  });
  return { hero, heroNormal, tree, trunk, canopy, leaves, mote };
}
