import { createScenery, frameScenery, type Scenery } from '@gm/sdk/scenery';
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

declare global {
  interface Window {
    sceneryReady?: boolean;
    sceneryError?: string;
    __ready?: boolean;
    __frame?: (seconds: number) => void;
  }
}

async function main(): Promise<void> {
  const input = (await (await fetch('./scene.json')).json()) as { scene: Scenery; assets: Record<string, string> };
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1000);
  frameScenery(camera, input.scene.camera);
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  document.body.style.margin = '0';
  document.body.append(renderer.domElement);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  scene.add(
    await createScenery({
      scene: input.scene,
      loadAsset: async (id) => {
        const path = input.assets[id];
        if (!path) throw new Error(`missing asset ${id}`);
        return (await loader.loadAsync(path)).scene;
      },
    }),
  );
  renderer.render(scene, camera);
  window.__frame = () => renderer.render(scene, camera);
  window.__ready = true;
  window.sceneryReady = true;
}
void main().catch((error: unknown) => {
  window.sceneryError = error instanceof Error ? error.message : String(error);
});
