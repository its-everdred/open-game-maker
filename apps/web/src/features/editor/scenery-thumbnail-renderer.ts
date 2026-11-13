import { AmbientLight, Box3, DirectionalLight, PerspectiveCamera, Scene, Texture, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const cache = new Map<string, Promise<string>>();
let queue = Promise.resolve();
let thumbnailRenderer: WebGLRenderer | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Render actual locked models one at a time so a palette cannot exhaust WebGL contexts. */
export function renderSceneryThumbnail(url: string): Promise<string> {
  const existing = cache.get(url);
  if (existing) return existing;
  const result = queue.then(() => render(url));
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  cache.set(url, result);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  void result.catch(() => {
    if (cache.get(url) === result) cache.delete(url);
  });
  return result;
}

async function render(url: string): Promise<string> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  let renderer: WebGLRenderer | undefined;
  try {
    const bounds = new Box3().setFromObject(model);
    if (bounds.isEmpty()) throw new Error('model has no visible bounds');
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.01);
    const scene = new Scene();
    scene.add(model, new AmbientLight(0xffffff, 1.5));
    const light = new DirectionalLight(0xffffff, 2);
    light.position.set(3, 6, 4);
    scene.add(light);
    const camera = new PerspectiveCamera(35, 1, radius / 100, radius * 100);
    camera.position.copy(center).add(new Vector3(1, 0.8, 1).normalize().multiplyScalar(radius * 2.8));
    camera.lookAt(center);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = undefined;
    renderer = thumbnailRenderer ??= new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(128, 128, false);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } catch (error) {
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      if (thumbnailRenderer === renderer) thumbnailRenderer = undefined;
      renderer = undefined;
    }
    throw error;
  } finally {
    if (renderer) {
      const used = renderer;
      idleTimer = setTimeout(() => {
        used.dispose();
        used.forceContextLoss();
        if (thumbnailRenderer === used) thumbnailRenderer = undefined;
        idleTimer = undefined;
      }, 30_000);
    }
    model.traverse((object) => {
      if (!('isMesh' in object) || !object.isMesh) return;
      const mesh = object as import('three').Mesh;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
        material.dispose();
      }
    });
  }
}
