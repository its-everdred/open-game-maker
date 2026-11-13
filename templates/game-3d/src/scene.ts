import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type Camera,
} from 'three';

import type { GameSave, LevelDesign, SceneAdapter } from './game.js';

export interface SceneHandle extends SceneAdapter {
  scene: Scene;
  camera: Camera;
  setCamera(camera: Camera): void;
  sync(state: GameSave): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createScene(design: LevelDesign): SceneHandle {
  const scene = new Scene();
  scene.background = new Color(0xb8c0c8);
  const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 200);
  const size = design.globals['level.size'];
  camera.position.set(size * 0.75, size * 0.7, size * 0.75);
  camera.lookAt(0, 0, 0);

  const floorMaterial = new MeshStandardMaterial({ color: 0x717b74, roughness: 0.9 });
  const wallMaterial = new MeshStandardMaterial({ color: 0x89929a, roughness: 0.85 });
  const playerMaterial = new MeshStandardMaterial({ color: 0xe5a34d, roughness: 0.65 });
  const floor = new Mesh(new BoxGeometry(size, 0.2, size), floorMaterial);
  floor.position.y = -0.1;
  scene.add(floor);

  const wallThickness = 0.25;
  const wallHeight = 2;
  const walls = [
    new Mesh(new BoxGeometry(size, wallHeight, wallThickness), wallMaterial),
    new Mesh(new BoxGeometry(size, wallHeight, wallThickness), wallMaterial),
    new Mesh(new BoxGeometry(wallThickness, wallHeight, size), wallMaterial),
    new Mesh(new BoxGeometry(wallThickness, wallHeight, size), wallMaterial),
  ];
  walls[0]!.position.set(0, wallHeight / 2, -size / 2);
  walls[1]!.position.set(0, wallHeight / 2, size / 2);
  walls[2]!.position.set(-size / 2, wallHeight / 2, 0);
  walls[3]!.position.set(size / 2, wallHeight / 2, 0);
  for (const wall of walls) wall.userData.occluder = true;
  scene.add(...walls);
  scene.add(new HemisphereLight(0xffffff, 0x4d5560, 2.2));
  const sun = new DirectionalLight(0xffffff, 2.5);
  sun.position.set(6, 10, 4);
  scene.add(sun);

  const players = new Map<string, Mesh>();
  const raycaster = new Raycaster();
  const projectedPosition = new Vector3();
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const groundPoint = new Vector3();

  const adapter: SceneHandle = {
    scene,
    camera,
    setCamera(nextCamera) {
      adapter.camera = nextCamera;
    },
    sync(state) {
      for (const [id, mesh] of players) {
        if (state.players[id]) continue;
        scene.remove(mesh);
        mesh.geometry.dispose();
        players.delete(id);
      }
      for (const player of Object.values(state.players)) {
        let mesh = players.get(player.id);
        if (!mesh) {
          mesh = new Mesh(new CapsuleGeometry(0.4, 1, 4, 8), playerMaterial);
          mesh.userData.entityId = player.id;
          players.set(player.id, mesh);
          scene.add(mesh);
        }
        mesh.position.fromArray(player.position);
      }
    },
    pick(nx, ny) {
      raycaster.setFromCamera(new Vector2(nx * 2 - 1, 1 - ny * 2), adapter.camera);
      return raycaster
        .intersectObjects([...players.values()], false)
        .map(({ object }) => ({ id: String(object.userData.entityId), kind: 'entity' as const }));
    },
    screenToWorld(nx, ny) {
      adapter.camera.updateMatrixWorld();
      raycaster.setFromCamera(new Vector2(nx * 2 - 1, 1 - ny * 2), adapter.camera);
      return raycaster.ray.intersectPlane(ground, groundPoint) ? groundPoint.toArray() : null;
    },
    worldToScreen(id) {
      const player = players.get(id);
      if (!player) return null;
      projectedPosition.copy(player.position).project(adapter.camera);
      if (projectedPosition.z < -1 || projectedPosition.z > 1) return null;
      return { x: (projectedPosition.x + 1) / 2, y: (1 - projectedPosition.y) / 2 };
    },
    resize(width, height) {
      if (width <= 0 || height <= 0) return;
      if (adapter.camera instanceof PerspectiveCamera) {
        adapter.camera.aspect = width / height;
        adapter.camera.updateProjectionMatrix();
      }
    },
    dispose() {
      floor.geometry.dispose();
      for (const wall of walls) wall.geometry.dispose();
      for (const mesh of players.values()) mesh.geometry.dispose();
      floorMaterial.dispose();
      wallMaterial.dispose();
      playerMaterial.dispose();
      players.clear();
    },
  };
  return adapter;
}
