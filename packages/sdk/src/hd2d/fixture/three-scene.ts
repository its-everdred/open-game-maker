import {
  Color,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
} from 'three';
import type { TestArt } from './testart.js';

function texture(canvas: HTMLCanvasElement): Texture {
  const result = new Texture(canvas);
  result.magFilter = NearestFilter;
  result.minFilter = NearestFilter;
  result.generateMipmaps = false;
  result.colorSpace = SRGBColorSpace;
  result.needsUpdate = true;
  return result;
}

/** The forest clearing as textured planes in screen pixels (y down from the top, like the Phaser scene). */
export function createThreeScene(
  art: TestArt,
  seed: number,
): { scene: Scene; camera: OrthographicCamera; step(ms: number): void } {
  const scene = new Scene();
  scene.background = new Color('#172128');
  const camera = new OrthographicCamera(0, 640, 360, 0, 0.1, 1000);
  camera.position.set(0, 0, 500);
  const rect = (color: string, x: number, y: number, width: number, height: number, z: number) => {
    const mesh = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ color }));
    mesh.position.set(x, 360 - y, z);
    scene.add(mesh);
    return mesh;
  };
  const plane = (canvas: HTMLCanvasElement, x: number, y: number, scale: number, z: number, tint = '#ffffff') => {
    const material = new MeshBasicMaterial({ map: texture(canvas), color: tint, transparent: true, alphaTest: 0.02 });
    const mesh = new Mesh(new PlaneGeometry(canvas.width * scale, canvas.height * scale), material);
    mesh.position.set(x, 360 - y, z);
    scene.add(mesh);
    return mesh;
  };

  rect('#22343a', 320, 70, 640, 140, 0);
  for (let i = 0; i < 10; i += 1) plane(art.tree, 32 + i * 66, 92 + ((i * 13 + seed) % 12), 0.6, 1, '#4b6a72');
  rect('#416345', 320, 268, 640, 184, 2);
  rect('#b58b50', 320, 302, 460, 10, 3);
  let sway: Mesh | undefined;
  for (let i = 0; i < 5; i += 1) {
    const x = 64 + i * 128;
    const y = 150 + ((i * 37 + seed) % 30);
    const depth = 10 + y / 10;
    plane(art.trunk, x, y, 1, depth);
    const canopy = plane(art.canopy, x, y - 60, 1, depth + 0.5);
    if (i === 2) sway = canopy;
  }
  const hero = plane(art.hero, 320, 252, 2, 50);
  for (let i = 0; i < 8; i += 1) plane(art.leaves, 40 + i * 80, 350, 1.5, 60, '#2c4a3a');

  return {
    scene,
    camera,
    step(ms: number) {
      if (sway) sway.rotation.z = Math.sin(ms / 620) * 0.05;
      hero.position.y = 360 - 252 - Math.round(Math.sin(ms / 340) * 2);
    },
  };
}
