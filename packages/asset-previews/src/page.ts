export const VIEWS = ['front', 'back', 'left', 'three-quarter', 'top', 'close'] as const;

export type View = (typeof VIEWS)[number];

export const PREVIEW_PAGE = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #9a9a9a; }
      canvas { display: block; width: 100%; height: 100%; }
    </style>
    <script type="importmap">{"imports":{"three":"/three.module.js"}}</script>
  </head>
  <body>
    <script type="module">
      import * as THREE from 'three';
      import { GLTFLoader } from '/GLTFLoader.js';
      import { MeshoptDecoder } from '/meshopt_decoder.module.js';

      const state = { ready: false, error: '', renderView: null, renderer: '' };
      window.__assetPreview = state;

      try {
        const canvas = document.createElement('canvas');
        document.body.append(canvas);
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        renderer.setSize(320, 320, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setClearColor(0x9a9a9a, 1);

        const gl = renderer.getContext();
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        state.renderer = String(gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER));

        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
          if (url.startsWith('data:') || url.startsWith('blob:')) return url;
          throw new Error('external glTF resources are refused');
        });
        const bytes = await (await fetch('/asset.glb')).arrayBuffer();
        const model = await new Promise((resolve, reject) => {
          new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).parse(bytes, '', resolve, reject);
        });

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x9a9a9a);
        scene.add(model.scene);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.2));
        const key = new THREE.DirectionalLight(0xffffff, 3.2);
        key.position.set(3, 4, 5);
        scene.add(key);

        const bounds = new THREE.Box3().setFromObject(model.scene);
        if (bounds.isEmpty()) throw new Error('model has no renderable bounds');
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z, 0.01);
        const camera = new THREE.PerspectiveCamera(35, 1, Math.max(0.001, radius / 100), radius * 100);
        const distance = radius / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.6;
        const directions = {
          front: [0, 0, 1],
          back: [0, 0, -1],
          left: [-1, 0, 0],
          top: [0, 1, 0],
          'three-quarter': [1, 0.8, 1],
          close: [1, 0.35, 1],
        };

        state.renderView = (view) => {
          const direction = new THREE.Vector3(...directions[view]).normalize();
          camera.position.copy(center).addScaledVector(direction, view === 'close' ? distance * 0.55 : distance);
          camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0);
          const target = center.clone();
          if (view === 'close') target.y += size.y / 3;
          camera.lookAt(target);
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
        };
        state.renderView('front');
        state.ready = true;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      }
    </script>
  </body>
</html>`;
