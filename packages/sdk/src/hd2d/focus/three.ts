import {
  AlwaysDepth,
  Color,
  DepthTexture,
  FogExp2,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  HalfFloatType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
} from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

import { blurForDepth, tiltShiftWeight } from './bands.js';
import { focusPlan, type FocusBackend, type FocusState, type ThreeFocusDeps } from './create.js';

/** Depth and screen bands sampled from the shared core, so the shader never re-derives the blur curve. */
const BANDS = 16;
const TAPS = 24;

const compositeShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform vec2 texel;
    uniform float near;
    uniform float far;
    uniform bool ortho;
    uniform vec2 sceneDistance;
    uniform float depthBands[${BANDS}];
    uniform float screenBands[${BANDS}];
    varying vec2 vUv;
    float band(const in float values[${BANDS}], float at) {
      float index = clamp(at, 0.0, 1.0) * float(${BANDS - 1});
      int low = int(floor(index));
      int high = min(low + 1, ${BANDS - 1});
      return mix(values[low], values[high], fract(index));
    }
    float radiusAt(vec2 uv, float depth) {
      float viewZ = ortho ? orthographicDepthToViewZ(depth, near, far) : perspectiveDepthToViewZ(depth, near, far);
      // 0 is the farthest scene object and 1 the nearest, like Phaser's game-object depth.
      float depth01 = (sceneDistance.y - -viewZ) / max(sceneDistance.y - sceneDistance.x, 1e-6);
      return max(band(depthBands, depth01), band(screenBands, 1.0 - uv.y));
    }
    void main() {
      float depth = texture2D(tDepth, vUv).x;
      float radius = radiusAt(vUv, depth);
      vec4 sum = texture2D(tColor, vUv);
      float count = 1.0;
      if (radius > 0.25) {
        for (int i = 1; i < ${TAPS}; i++) {
          float r = sqrt(float(i) / float(${TAPS})) * radius;
          float a = float(i) * 2.39996323;
          // Texel centres, so a tap never filters in a neighbour whose depth it did not test.
          vec2 uv = (floor((vUv + vec2(cos(a), sin(a)) * r * texel) / texel) + 0.5) * texel;
          // Scatter-as-gather: a sample counts only if its own blur reaches here, so sharp layers never halo.
          if (radiusAt(uv, texture2D(tDepth, uv).x) < r) continue;
          sum += texture2D(tColor, uv);
          count += 1.0;
        }
      }
      gl_FragColor = sum / count;
      gl_FragDepth = depth;
      #include <colorspace_fragment>
    }`,
};

function isRenderable(object: Object3D): boolean {
  const flags = object as Object3D & { isMesh?: boolean; isSprite?: boolean; isPoints?: boolean; isLine?: boolean };
  return Boolean(flags.isMesh || flags.isSprite || flags.isPoints || flags.isLine);
}

/**
 * three.js focus: haze (FogExp2 plus a background tint) and a depth-band compositor that renders the scene
 * without the hero, blurs it by depth band, then draws the hero unblurred on top. BokehPass is used only for
 * `depthOfField` at high quality.
 */
export function createThreeFocus(deps: ThreeFocusDeps, state: FocusState): FocusBackend {
  const { renderer, scene } = deps;
  if (!deps.camera) throw new TypeError('three focus needs deps.camera');
  const camera: Camera = deps.camera;
  const original = renderer.render;
  const fog = new FogExp2(0xffffff, 0);
  const size = new Vector2();
  const point = new Vector3();
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new ShaderMaterial({
    ...compositeShader,
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      texel: { value: new Vector2() },
      near: { value: 0 },
      far: { value: 1 },
      ortho: { value: true },
      sceneDistance: { value: new Vector2() },
      depthBands: { value: new Array<number>(BANDS).fill(0) },
      screenBands: { value: new Array<number>(BANDS).fill(0) },
    },
    depthTest: true,
    depthWrite: true,
    depthFunc: AlwaysDepth,
  });
  const quad = new Scene().add(new Mesh(new PlaneGeometry(2, 2), material));
  let target: WebGLRenderTarget | undefined;
  let composer: { composer: EffectComposer; bokeh: BokehPass } | undefined;
  let lastTime: number | undefined;
  let focusDistance = 0;
  /** The focus point's screen row, 0 at the top, so the tilt-shift band follows it as in Phaser. */
  let focusScreenY = 0.5;
  let busy = false;
  let disposed = false;

  const viewDistance = (object: Object3D) => -object.getWorldPosition(point).applyMatrix4(camera.matrixWorldInverse).z;

  /** Nearest and farthest renderable view distances, widened to include the focus point, into `out`. */
  function sceneDistance(out: Vector2): Vector2 {
    let min = focusDistance;
    let max = focusDistance;
    scene.traverseVisible((object) => {
      if (!isRenderable(object)) return;
      const distance = viewDistance(object);
      min = Math.min(min, distance);
      max = Math.max(max, distance);
    });
    return out.set(min, max);
  }

  /** Renders the scene (hero hidden by the caller) into a target of the given size with its depth. */
  function renderToTarget(width: number, height: number): WebGLRenderTarget {
    if (!target || target.width !== width || target.height !== height) {
      target?.dispose();
      target = new WebGLRenderTarget(width, height, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        // Half float is linearly filterable in WebGL2 core and keeps flat colours exact through the round trip.
        type: HalfFloatType,
        depthTexture: new DepthTexture(width, height),
      });
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    try {
      original.call(renderer, scene, camera);
    } finally {
      renderer.setRenderTarget(previous);
    }
    return target;
  }

  /** Runs `draw` with only the hero (and lights) visible, the hero alone keeping its own pixels. */
  function withOnlyHero(hero: Object3D, draw: () => void): void {
    const hidden: Object3D[] = [];
    const related = new Set<Object3D>();
    hero.traverse((object) => related.add(object));
    for (let parent: Object3D | null = hero; parent; parent = parent.parent) related.add(parent);
    scene.traverse((object) => {
      if (!related.has(object) && object.visible && isRenderable(object)) {
        object.visible = false;
        hidden.push(object);
      }
    });
    try {
      draw();
    } finally {
      for (const object of hidden) object.visible = true;
    }
  }

  function renderBokeh(width: number, height: number): void {
    composer ??= (() => {
      const effect = new EffectComposer(renderer);
      const bokeh = new BokehPass(scene, camera, {});
      effect.addPass(new RenderPass(scene, camera));
      effect.addPass(bokeh);
      effect.addPass(new OutputPass());
      effect.setPixelRatio(1);
      // BokehShader assumes a perspective camera; an orthographic depth buffer needs the other conversion.
      bokeh.materialBokeh.defines.PERSPECTIVE_CAMERA = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera
        ? 1
        : 0;
      bokeh.materialBokeh.needsUpdate = true;
      return { composer: effect, bokeh };
    })();
    composer.composer.setSize(width, height);
    const uniforms = composer.bokeh.uniforms as Record<string, { value: number }>;
    uniforms.focus!.value = focusDistance;
    uniforms.aperture!.value = state.config.strength * 0.0005;
    uniforms.maxblur!.value = state.config.strength * 0.02;
    composer.composer.render();
  }

  function composite(): void {
    const { config, atmosphere } = state;
    const plan = focusPlan(config, renderer.getPixelRatio());
    const hero = deps.hero;
    const savedFog = scene.fog;
    const savedBackground = scene.background;
    const haze = atmosphere.haze;
    if (haze?.distance) {
      fog.color.set(haze.color);
      fog.density = (haze.density ?? 1) / haze.distance;
      scene.fog = fog;
      // Tint a flat background toward the haze so the horizon has no seam.
      if (savedBackground instanceof Color)
        scene.background = savedBackground.clone().lerp(fog.color, haze.density ?? 1);
    }
    const heroVisible = hero?.visible ?? false;
    if (hero) hero.visible = false;
    try {
      renderer.getDrawingBufferSize(size);
      const width = Math.max(1, Math.round(size.x * plan.scale));
      const height = Math.max(1, Math.round(size.y * plan.scale));
      const uniforms = material.uniforms;
      const distances = sceneDistance(uniforms.sceneDistance!.value as Vector2);
      const rt = renderToTarget(width, height);
      // DOF draws its own colour; the band pass then only restores scene depth so occluders still cover the hero.
      if (plan.bokeh) renderBokeh(width, height);
      const span = Math.max(distances.y - distances.x, Number.EPSILON);
      const focus01 = (distances.y - focusDistance) / span;
      uniforms.tColor!.value = rt.texture;
      uniforms.tDepth!.value = rt.depthTexture;
      (uniforms.texel!.value as Vector2).set(1 / width, 1 / height);
      const projection = camera as Camera & { near?: number; far?: number; isOrthographicCamera?: boolean };
      uniforms.near!.value = projection.near ?? 0.1;
      uniforms.far!.value = projection.far ?? 1000;
      uniforms.ortho!.value = Boolean(projection.isOrthographicCamera);
      const depthBands = uniforms.depthBands!.value as number[];
      const screenBands = uniforms.screenBands!.value as number[];
      for (let index = 0; index < BANDS; index += 1) {
        const at = index / (BANDS - 1);
        // Radii are full-resolution pixels; the target is scaled, so scale them with it.
        depthBands[index] = blurForDepth(config, at, focus01) * plan.scale;
        screenBands[index] = tiltShiftWeight(config, 0.5 + at - focusScreenY) * 12 * plan.scale;
      }
      const autoClear = renderer.autoClear;
      material.colorWrite = !plan.bokeh;
      renderer.autoClear = !plan.bokeh;
      try {
        original.call(renderer, quad, quadCamera);
        if (hero && heroVisible) {
          hero.visible = true;
          renderer.autoClear = false;
          scene.fog = null;
          scene.background = null;
          withOnlyHero(hero, () => original.call(renderer, scene, camera));
        }
      } finally {
        material.colorWrite = true;
        renderer.autoClear = autoClear;
      }
    } finally {
      if (hero) hero.visible = heroVisible;
      scene.fog = savedFog;
      scene.background = savedBackground;
    }
  }

  function needsComposite(): boolean {
    const { config, atmosphere } = state;
    return !focusPlan(config).bypass && (config.mode !== 'off' || Boolean(atmosphere.haze?.distance));
  }

  // Route the game's own canvas renders of this scene through the compositor, so callers keep calling render().
  const patched: typeof renderer.render = (renderScene, renderCamera) => {
    if (
      disposed ||
      busy ||
      renderScene !== scene ||
      renderCamera !== camera ||
      renderer.getRenderTarget() !== null ||
      !needsComposite()
    )
      return original.call(renderer, renderScene, renderCamera);
    busy = true;
    try {
      composite();
    } finally {
      busy = false;
    }
  };
  renderer.render = patched;

  return {
    update(timeMs) {
      const dt = lastTime === undefined ? 0 : timeMs - lastTime;
      lastTime = timeMs;
      camera.updateMatrixWorld();
      const focusTarget = state.config.target;
      if (focusTarget === 'player' && !deps.hero) return;
      const at =
        focusTarget === 'player'
          ? deps.hero!.getWorldPosition(point)
          : point.set(focusTarget.x, focusTarget.y, focusTarget.z ?? 0);
      const followed = state.follower.step({ x: at.x, y: at.y, z: at.z }, dt);
      point.set(followed.x, followed.y, followed.z ?? 0);
      focusScreenY = 0.5 - point.clone().project(camera).y / 2;
      focusDistance = -point.applyMatrix4(camera.matrixWorldInverse).z;
    },
    dispose() {
      disposed = true;
      // Only unwrap when no later wrapper sits on top of ours; otherwise ours stays as a pass-through.
      if (renderer.render === patched) renderer.render = original;
      target?.dispose();
      composer?.composer.dispose();
      composer?.bokeh.dispose();
      material.dispose();
    },
  };
}
