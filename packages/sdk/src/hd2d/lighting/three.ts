import {
  AmbientLight,
  DataTexture,
  FramebufferTexture,
  LinearFilter,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  type Camera,
  Material,
  type WebGLRenderer,
} from 'three';
import { flickerAt } from './flicker.js';
import { FIELD_SIZE, gradeMatrix, hexToRgb01, renderLightField } from './field.js';
import type { Lighting, LightingLight, LightingOptions, NormalSource, ScreenLight } from './field.js';
import { maxLightsFor, type LightingPreset, type LightingQuality } from './schema.js';

const MAX_LIGHTS = maxLightsFor('high');
// ponytail: one fixed light plane in front of the sprites; take a z per light if scenes need depth-placed lights.
const LIGHT_Z = 100;

const fragmentShader = /* glsl */ `
uniform sampler2D scene;
uniform sampler2D field;
uniform mat3 grade;
uniform vec3 offset;
varying vec2 vUv;
void main() {
  vec3 color = grade * texture2D(scene, vUv).rgb + offset;
  vec4 light = texture2D(field, vUv);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0) * light.a + light.rgb, 1.0);
}`;
const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * three.js lighting: preallocated point lights (intensity animated, never added or removed in play) light the
 * normal-mapped sprite planes; one post pass grades the frame and composites the low-resolution light field.
 */
export function createThreeLighting(
  target: { renderer: WebGLRenderer; scene: Scene; camera: Camera },
  initial: LightingPreset,
  { quality: startQuality = 'high', seed = 1 }: LightingOptions = {},
): Lighting {
  const { renderer, scene, camera } = target;
  let preset = initial;
  let quality = startQuality;
  let lights: LightingLight[] = [...(initial.lights ?? [])];
  let screenLights: ScreenLight[] = [];
  const ambient = new AmbientLight(0xffffff, Math.PI * 0.8);
  const points = Array.from({ length: MAX_LIGHTS }, () => new PointLight(0xffffff, 0, 1, 0));
  const lit = new Map<Mesh, { original: Material | Material[]; lit: MeshStandardMaterial }>();

  let fieldData = new Uint8ClampedArray(0);
  let field: DataTexture | undefined;
  let frame: FramebufferTexture | undefined;
  const uniforms = {
    scene: { value: null as FramebufferTexture | null },
    field: { value: null as DataTexture | null },
    grade: { value: new Matrix3() },
    offset: { value: new Vector3() },
  };
  const post = new Mesh(
    new PlaneGeometry(2, 2),
    new ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false }),
  );
  post.frustumCulled = false;
  const postScene = new Scene().add(post);
  const postCamera = new OrthographicCamera();
  const size = new Vector2();
  let previousAfterRender = scene.onAfterRender;
  const afterRender: Scene['onAfterRender'] = (...args) => {
    previousAfterRender.apply(scene, args);
    // Another hook may have chained on top of ours; once detached, stay a pass-through.
    if (!attached()) return;
    renderer.getDrawingBufferSize(size);
    if (!frame || frame.image.width !== size.x || frame.image.height !== size.y) {
      frame?.dispose();
      frame = new FramebufferTexture(size.x, size.y);
      frame.minFilter = frame.magFilter = NearestFilter;
      uniforms.scene.value = frame;
    }
    renderer.copyFramebufferToTexture(frame);
    renderer.render(postScene, postCamera);
  };

  function attached(): boolean {
    return quality !== 'off';
  }

  function setQuality(next: LightingQuality): void {
    quality = next;
    const on = attached();
    for (const object of [ambient, ...points]) {
      if (on) scene.add(object);
      else scene.remove(object);
    }
    // Only unhook when the scene still points at us, so other lighting instances keep their own hooks.
    if (on && scene.onAfterRender !== afterRender) {
      previousAfterRender = scene.onAfterRender;
      scene.onAfterRender = afterRender;
    } else if (!on && scene.onAfterRender === afterRender) scene.onAfterRender = previousAfterRender;
    for (const [mesh, materials] of lit) mesh.material = on ? materials.lit : materials.original;
    if (next !== 'off') {
      const [width, height] = FIELD_SIZE[next];
      fieldData = new Uint8ClampedArray(width * height * 4);
      for (let i = 3; i < fieldData.length; i += 4) fieldData[i] = 255; // keep the scene until the first update
      field?.dispose();
      field = new DataTexture(fieldData, width, height);
      field.minFilter = field.magFilter = LinearFilter;
      field.flipY = true;
      uniforms.field.value = field;
    }
  }

  function apply(next: LightingPreset): void {
    preset = next;
    lights = [...(next.lights ?? [])];
    const g = gradeMatrix(next);
    uniforms.grade.value.set(g[0]!, g[1]!, g[2]!, g[4]!, g[5]!, g[6]!, g[8]!, g[9]!, g[10]!);
    uniforms.offset.value.set(g[3]!, g[7]!, g[11]!);
  }

  const projected = new Vector3();
  function update(timeMs: number): void {
    if (!attached() || !field) return;
    const active = lights.slice(0, maxLightsFor(quality));
    screenLights = [];
    points.forEach((point, index) => {
      const light = active[index];
      if (!light) {
        point.intensity = 0;
        return;
      }
      const amount = light.intensity * (light.flicker ? flickerAt(light.flicker, timeMs) : 1);
      point.position.set(light.x, light.y, LIGHT_Z);
      point.color.setRGB(...hexToRgb01(light.color));
      point.distance = Math.hypot(light.radius, LIGHT_Z);
      point.intensity = amount * Math.PI * 2;
      const centre = projected.set(light.x, light.y, 0).project(camera);
      const x = (centre.x + 1) / 2;
      const y = (1 - centre.y) / 2;
      const edge = projected.set(light.x, light.y + light.radius, 0).project(camera);
      screenLights.push({
        x,
        y,
        radius: Math.abs((1 - edge.y) / 2 - y),
        color: hexToRgb01(light.color),
        amount,
        falloff: light.falloff ?? 2,
      });
    });
    renderLightField(
      fieldData,
      field.image.width,
      field.image.height,
      preset,
      timeMs,
      seed,
      screenLights,
      // The last drawn frame's size; before the first render the field's own shape stands in.
      size.y > 0 ? size.x / size.y : undefined,
    );
    field.needsUpdate = true;
  }

  function setNormalMap(sprite: unknown, normal: NormalSource): void {
    if (!(sprite instanceof Mesh)) throw new Error('three lighting needs a Mesh sprite');
    let entry = lit.get(sprite);
    if (!entry) {
      const source = sprite.material;
      if (!(source instanceof MeshBasicMaterial)) throw new Error('three lighting needs a MeshBasicMaterial sprite');
      const material = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
      // The base Material copy carries opacity, side, blending, depth and alpha-test state across.
      Material.prototype.copy.call(material, source);
      material.map = source.map;
      material.alphaMap = source.alphaMap;
      material.color.copy(source.color);
      entry = { original: sprite.material, lit: material };
      lit.set(sprite, entry);
    }
    entry.lit.normalMap?.dispose();
    entry.lit.normalMap = null;
    if (normal !== 'flat') {
      const map = new Texture(normal);
      map.minFilter = map.magFilter = NearestFilter;
      map.generateMipmaps = false;
      map.needsUpdate = true;
      entry.lit.normalMap = map;
    }
    entry.lit.needsUpdate = true;
    if (attached()) sprite.material = entry.lit;
  }

  apply(initial);
  setQuality(quality);
  return {
    apply,
    addLight(light) {
      lights = [...lights.filter((existing) => existing.id !== light.id), light];
    },
    removeLight(id) {
      lights = lights.filter((light) => light.id !== id);
    },
    setQuality,
    setNormalMap,
    update,
    dispose() {
      setQuality('off');
      for (const { lit: material } of lit.values()) {
        material.normalMap?.dispose();
        material.dispose();
      }
      lit.clear();
      field?.dispose();
      frame?.dispose();
      post.geometry.dispose();
      (post.material as ShaderMaterial).dispose();
    },
  };
}
