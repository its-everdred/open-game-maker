import {
  AmbientLight,
  Box3,
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Object3D,
} from 'three';
import type { Scenery } from './data.js';

/** The protected rectangle is in world X/Z coordinates. */
export interface PlayArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface SceneryRenderOptions {
  scene: Scenery;
  playArea?: PlayArea;
  /** Return a fresh object for each placement; callers own loaded assets. */
  loadAsset: (id: string) => Promise<Object3D>;
}

function overlaps(box: Box3, area?: PlayArea): boolean {
  return (
    !!area &&
    !box.isEmpty() &&
    box.max.x > area.minX &&
    box.min.x < area.maxX &&
    box.max.z > area.minZ &&
    box.min.z < area.maxZ
  );
}

/** Build a group independently of a game scene, omitting objects that intersect its play area. */
export async function createScenery(options: SceneryRenderOptions): Promise<Group> {
  const area = options.playArea;
  if (
    area &&
    (![area.minX, area.maxX, area.minZ, area.maxZ].every(Number.isFinite) ||
      area.minX >= area.maxX ||
      area.minZ >= area.maxZ)
  ) {
    throw new Error('play area must have finite, increasing bounds');
  }
  const root = new Group();
  root.name = 'scenery';
  const lighting = {
    'warm-forest': [0xffe4b0, 1.5, 0xffd394, 2],
    night: [0x6576ad, 0.6, 0xa7baff, 0.8],
    cave: [0x8c8174, 0.55, 0xffc681, 0.8],
  } as const;
  const [ambientColor, ambientIntensity, sunColor, sunIntensity] = lighting[options.scene.lighting];
  root.add(new AmbientLight(ambientColor, ambientIntensity));
  const sun = new DirectionalLight(sunColor, sunIntensity);
  sun.position.set(4, 8, 5);
  root.add(sun);
  const objects = await Promise.all(options.scene.items.map((item) => options.loadAsset(item.assetId)));
  for (const [index, item] of options.scene.items.entries()) {
    const object = objects[index]!;
    object.position.fromArray(item.position);
    object.rotation.set(...item.rotation);
    object.scale.fromArray(item.scale);
    object.userData.sceneryId = item.id;
    object.userData.sceneryLayer = item.layer;
    object.updateMatrixWorld(true);
    if (!overlaps(new Box3().setFromObject(object), options.playArea)) root.add(object);
  }
  const colors = { grass: 0x759f4e, path: 0xb59a72, water: 0x559fc3 };
  for (const band of options.scene.terrain) {
    for (let i = 1; i < band.points.length; i++) {
      const start = new Vector3().fromArray(band.points[i - 1]!);
      const end = new Vector3().fromArray(band.points[i]!);
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      if (length === 0) continue;
      const mesh = new Mesh(
        new BoxGeometry(band.width, 0.02, length),
        new MeshStandardMaterial({ color: colors[band.kind] }),
      );
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
      mesh.userData.sceneryId = band.id;
      mesh.updateMatrixWorld(true);
      if (overlaps(new Box3().setFromObject(mesh), options.playArea)) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      } else root.add(mesh);
    }
  }
  return root;
}

/** Apply the scene's saved framing to a game-provided camera. */
export function frameScenery(camera: import('three').Camera, framing: Scenery['camera']): void {
  camera.position.fromArray(framing.position);
  camera.lookAt(...framing.target);
  if ('zoom' in camera && 'updateProjectionMatrix' in camera) {
    const projected = camera as import('three').PerspectiveCamera | import('three').OrthographicCamera;
    projected.zoom = framing.zoom;
    projected.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}
