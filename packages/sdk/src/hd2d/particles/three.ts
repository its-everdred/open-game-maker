import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearSRGBColorSpace,
  Matrix4,
  NearestFilter,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  type Camera,
  type Object3D,
  type WebGLRenderer,
} from 'three';

import { PARTICLE_LIMITS } from './schema.js';
import type { Family, ParticleBackend } from './create.js';
import { leafCanvas, moteCanvas } from './textures.js';

const vertexShader = /* glsl */ `
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vColor = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
// Colours are passed through as sRGB bytes, like the fixture's unlit sprites.
const fragmentShader = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 texel = texture2D(map, vUv);
  float alpha = texel.a * vAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(texel.rgb * vColor, alpha);
}`;

/** Draws over the scene's sprites, like the Phaser layers. */
const RENDER_ORDER = 1000;

/**
 * three.js particles: one `InstancedMesh` of camera-facing quads per family, sized for the scene's limits up front;
 * each frame only rewrites instance matrices, colours and alphas.
 */
export function createThreeParticles(target: {
  renderer: WebGLRenderer;
  scene: Object3D;
  camera: Camera;
  parent?: Object3D;
}): ParticleBackend {
  const { renderer, camera } = target;
  const parent = target.parent ?? target.scene;
  const geometry = new PlaneGeometry(1, 1);
  const meshes = [
    { canvas: leafCanvas(), capacity: PARTICLE_LIMITS.visible, filter: NearestFilter, blending: NormalBlending },
    { canvas: moteCanvas(), capacity: PARTICLE_LIMITS.soft, filter: LinearFilter, blending: AdditiveBlending },
  ].map(({ canvas, capacity, filter, blending }) => {
    const map = new Texture(canvas);
    map.magFilter = filter;
    map.minFilter = filter;
    map.generateMipmaps = false;
    map.needsUpdate = true;
    const material = new ShaderMaterial({
      uniforms: { map: { value: map } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending,
    });
    const instanced = geometry.clone();
    instanced.setAttribute('aAlpha', new InstancedBufferAttribute(new Float32Array(capacity), 1));
    const mesh = new InstancedMesh(instanced, material, capacity);
    mesh.setColorAt(0, new Color());
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = RENDER_ORDER;
    parent.add(mesh);
    return mesh;
  });

  // Scratch values: nothing below allocates per frame.
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const facing = new Quaternion();
  const turn = new Quaternion();
  const spin = new Quaternion();
  const parentRotation = new Quaternion();
  const cameraRotation = new Quaternion();
  const axis = new Vector3(0, 0, 1);
  const up = new Vector3();
  const ndc = new Vector3();
  const color = new Color();
  const buffer = new Vector2();
  let unit = 1;

  function commit(mesh: InstancedMesh, used: number): void {
    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.geometry.getAttribute('aAlpha').needsUpdate = true;
  }

  return {
    begin() {
      parent.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      // Billboards: the camera's rotation expressed in the parent's space.
      parent.getWorldQuaternion(parentRotation);
      camera.getWorldQuaternion(cameraRotation);
      facing.copy(cameraRotation).premultiply(parentRotation.invert());
      renderer.getDrawingBufferSize(buffer);
      parent.getWorldScale(scale);
      unit = scale.y;
    },
    screen(x, y, z, out) {
      position.set(x, y, z).applyMatrix4(parent.matrixWorld);
      ndc.copy(position).project(camera);
      out[0] = (ndc.x + 1) / 2;
      out[1] = (1 - ndc.y) / 2;
      // Pixels per pool unit at this point: project one unit along the camera's up axis.
      up.set(0, 1, 0).applyQuaternion(cameraRotation).multiplyScalar(unit).add(position).project(camera);
      out[2] = (Math.hypot(up.x - ndc.x, up.y - ndc.y) * buffer.y) / 2;
    },
    draw(family: Family, slot, x, y, z, rot, size, alpha, hex) {
      const mesh = meshes[family]!;
      turn.copy(facing).multiply(spin.setFromAxisAngle(axis, rot));
      matrix.compose(position.set(x, y, z), turn, scale.set(size, size, size));
      mesh.setMatrixAt(slot, matrix);
      mesh.setColorAt(slot, color.setHex(hex, LinearSRGBColorSpace));
      (mesh.geometry.getAttribute('aAlpha') as InstancedBufferAttribute).setX(slot, alpha);
    },
    end(pixel, soft) {
      commit(meshes[0]!, pixel);
      commit(meshes[1]!, soft);
    },
    dispose() {
      for (const mesh of meshes) {
        parent.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as ShaderMaterial).uniforms.map!.value.dispose();
        (mesh.material as ShaderMaterial).dispose();
        mesh.dispose();
      }
      geometry.dispose();
    },
  };
}
