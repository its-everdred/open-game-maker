/** Where effects are drawn from: column-major 4x4 matrices, as Effekseer and three.js store them. */
export interface VfxCamera {
  projection: Float32Array;
  view: Float32Array;
  /** 2D worlds put y down; effects are authored y up, so a play position's y is negated before it reaches Effekseer. */
  yDown: boolean;
}

/** A visible world rectangle in world pixels, as Phaser's `camera.worldView` gives it. */
export interface WorldView {
  x: number;
  y: number;
  width: number;
  height: number;
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const DEPTH = 1000;

/**
 * A front-on orthographic camera over a 2D world (Phaser, including isometric games, whose art is already projected).
 * One effect unit is one world pixel: load effects with `scale` set to the pixels an authored unit should cover.
 */
export function orthoCamera(view: WorldView): VfxCamera {
  const left = view.x;
  const right = view.x + view.width;
  // Effect space is y up: world y = -effect y.
  const top = -view.y;
  const bottom = -(view.y + view.height);
  const projection = new Float32Array(16);
  projection[0] = 2 / (right - left);
  projection[5] = 2 / (top - bottom);
  projection[10] = -1 / DEPTH;
  projection[12] = -(right + left) / (right - left);
  projection[13] = -(top + bottom) / (top - bottom);
  projection[15] = 1;
  return { projection, view: IDENTITY, yDown: true };
}

/** Phaser's main camera: effects follow its scroll and zoom. */
export function phaserCamera(camera: { worldView: WorldView }): VfxCamera {
  return orthoCamera(camera.worldView);
}

/** A three.js camera: effects share its projection and view, so they sit in the 3D world at world-unit positions. */
export function threeCamera(camera: {
  projectionMatrix: { elements: ArrayLike<number> };
  matrixWorldInverse: { elements: ArrayLike<number> };
}): VfxCamera {
  return {
    projection: Float32Array.from(camera.projectionMatrix.elements),
    view: Float32Array.from(camera.matrixWorldInverse.elements),
    yDown: false,
  };
}
