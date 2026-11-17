/** Retain closed roots created after navigation so captures can inspect their contents. */
export function trackShadowRoots(): void {
  const roots = new WeakMap<Element, ShadowRoot>();
  const ignored = new WeakSet<Node>();
  let version = 0;
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const frames = new Map<number, { callback: FrameRequestCallback; native?: number }>();
  let nextFrame = 0;
  let paused = false;
  const schedule = (id: number) => {
    const entry = frames.get(id);
    if (!entry || paused) return;
    entry.native = nativeRaf((time) => {
      if (paused) {
        entry.native = undefined;
        return;
      }
      frames.delete(id);
      entry.callback(time);
    });
  };
  window.requestAnimationFrame = (callback) => {
    const id = ++nextFrame;
    frames.set(id, { callback });
    schedule(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    const entry = frames.get(id);
    if (entry?.native !== undefined) nativeCancel(entry.native);
    frames.delete(id);
  };
  const relevant = (record: MutationRecord): boolean => {
    const target = record.target instanceof ShadowRoot ? record.target.host : record.target;
    if (ignored.has(target)) return false;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return nodes.length === 0 || nodes.some((node) => !ignored.has(node));
  };
  const observer = new MutationObserver((records) => {
    if (records.some(relevant)) version++;
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  type Draw = {
    canvas: HTMLCanvasElement;
    file: string;
    sourceWidth: number;
    sourceHeight: number;
    drawnWidth: number;
    drawnHeight: number;
    a: number;
    b: number;
    c: number;
    d: number;
  };
  const canvasDraws = new Map<HTMLCanvasElement, Map<string, Draw>>();
  const webglCanvases = new Set<HTMLCanvasElement>();
  const webglDraws = new Map<HTMLCanvasElement, { count: number; unsupported: boolean }>();
  const webglExtensions = new Set<HTMLCanvasElement>();
  const originalContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
    const context = Reflect.apply(originalContext, this, [kind, ...args]);
    if (context && (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl')) webglCanvases.add(this);
    return context;
  } as typeof HTMLCanvasElement.prototype.getContext;
  const webglPrototypes = [
    typeof WebGLRenderingContext === 'undefined' ? undefined : WebGLRenderingContext.prototype,
    typeof WebGL2RenderingContext === 'undefined' ? undefined : WebGL2RenderingContext.prototype,
  ];
  for (const prototype of webglPrototypes) {
    if (!prototype) continue;
    for (const name of [
      'clear',
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
      'drawRangeElements',
      'blitFramebuffer',
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (typeof descriptor?.value !== 'function' || !descriptor.writable) continue;
      const original = descriptor.value as (...args: unknown[]) => unknown;
      Object.defineProperty(prototype, name, {
        ...descriptor,
        value: function (this: unknown, ...args: unknown[]) {
          const result = Reflect.apply(original, this, args);
          if (name.startsWith('draw') || name === 'blitFramebuffer') {
            const gl = this as WebGLRenderingContext | WebGL2RenderingContext;
            const canvas = gl.canvas;
            if (canvas instanceof HTMLCanvasElement) {
              const entry = webglDraws.get(canvas) ?? { count: 0, unsupported: false };
              const mode = Number(args[0]);
              const count = Number(args[name.startsWith('drawArrays') ? 2 : 1]);
              const instances = name.endsWith('Instanced') ? Number(args[name.startsWith('drawArrays') ? 3 : 4]) : 1;
              entry.count++;
              entry.unsupported ||=
                name === 'drawRangeElements' ||
                name === 'blitFramebuffer' ||
                instances !== 1 ||
                !(
                  (mode === gl.TRIANGLES && count === 6) ||
                  ((mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN) && count === 4)
                );
              webglDraws.set(canvas, entry);
            }
          }
          version++;
          return result;
        },
      });
    }
    const extension = Object.getOwnPropertyDescriptor(prototype, 'getExtension');
    if (typeof extension?.value === 'function' && extension.writable) {
      const original = extension.value as (...args: unknown[]) => unknown;
      Object.defineProperty(prototype, 'getExtension', {
        ...extension,
        value: function (this: WebGLRenderingContext, ...args: unknown[]) {
          const result = Reflect.apply(original, this, args);
          if (
            result &&
            /^(ANGLE_instanced_arrays|WEBGL_multi_draw)$/i.test(String(args[0])) &&
            this.canvas instanceof HTMLCanvasElement
          )
            webglExtensions.add(this.canvas);
          return result;
        },
      });
    }
  }
  const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (
    this: CanvasRenderingContext2D,
    image: CanvasImageSource,
    ...args: number[]
  ) {
    Reflect.apply(originalDraw, this, [image, ...args]);
    version++;
    const source = image as CanvasImageSource & {
      naturalWidth?: number;
      naturalHeight?: number;
      videoWidth?: number;
      videoHeight?: number;
      width?: number;
      height?: number;
      currentSrc?: string;
      src?: string;
    };
    const naturalWidth = source.naturalWidth ?? source.videoWidth ?? source.width ?? 0;
    const naturalHeight = source.naturalHeight ?? source.videoHeight ?? source.height ?? 0;
    const sourceWidth = args.length === 8 ? args[2]! : naturalWidth;
    const sourceHeight = args.length === 8 ? args[3]! : naturalHeight;
    const drawnWidth = args.length === 8 ? args[6]! : args.length === 4 ? args[2]! : sourceWidth;
    const drawnHeight = args.length === 8 ? args[7]! : args.length === 4 ? args[3]! : sourceHeight;
    const matrix = this.getTransform();
    const file = source.currentSrc || source.src || 'canvas source';
    const draw = {
      canvas: this.canvas,
      file,
      sourceWidth,
      sourceHeight,
      drawnWidth,
      drawnHeight,
      a: matrix.a,
      b: matrix.b,
      c: matrix.c,
      d: matrix.d,
    };
    let entries = canvasDraws.get(this.canvas);
    if (!entries) {
      entries = new Map();
      canvasDraws.set(this.canvas, entries);
    }
    const key = JSON.stringify([
      file,
      sourceWidth,
      sourceHeight,
      drawnWidth,
      drawnHeight,
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
    ]);
    if (entries.size >= 10_000 && !entries.has(key)) {
      entries.set('__overflow__', { ...draw, sourceWidth: 0, sourceHeight: 0 });
    } else entries.set(key, draw);
  } as typeof CanvasRenderingContext2D.prototype.drawImage;
  const originalClear = CanvasRenderingContext2D.prototype.clearRect;
  const clippedContexts = new WeakSet<CanvasRenderingContext2D>();
  const originalClip = CanvasRenderingContext2D.prototype.clip;
  CanvasRenderingContext2D.prototype.clip = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
    Reflect.apply(originalClip, this, args);
    clippedContexts.add(this);
  } as typeof CanvasRenderingContext2D.prototype.clip;
  CanvasRenderingContext2D.prototype.clearRect = function (x, y, width, height) {
    const matrix = this.getTransform();
    if (
      !clippedContexts.has(this) &&
      matrix.isIdentity &&
      x <= 0 &&
      y <= 0 &&
      width >= this.canvas.width &&
      height >= this.canvas.height
    )
      canvasDraws.delete(this.canvas);
    originalClear.call(this, x, y, width, height);
    version++;
  };
  for (const key of ['width', 'height'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key);
    if (descriptor?.set && descriptor.configurable)
      Object.defineProperty(HTMLCanvasElement.prototype, key, {
        ...descriptor,
        set(value: number) {
          canvasDraws.delete(this as HTMLCanvasElement);
          descriptor.set!.call(this, value);
          version++;
        },
      });
  }
  const debug = window as unknown as {
    __gmShadowRoots: WeakMap<Element, ShadowRoot>;
    __gmCaptureVersion: () => number;
    __gmIgnoreCaptureProbe: (node: Node) => void;
    __gmCanvasDraws: () => Draw[];
    __gmWebglCanvases: () => HTMLCanvasElement[];
    __gmWebglDraws: () => { canvas: HTMLCanvasElement; count: number; unsupported: boolean }[];
    __gmBeginUiFrame: () => void;
    __gmCapturePause: () => void;
    __gmCaptureResume: () => void;
    __gmCapturePausedAt?: number;
  };
  debug.__gmShadowRoots = roots;
  debug.__gmIgnoreCaptureProbe = (node) => ignored.add(node);
  debug.__gmCanvasDraws = () => {
    for (const canvas of canvasDraws.keys()) if (!canvas.isConnected) canvasDraws.delete(canvas);
    return [...canvasDraws.values()].flatMap((entries) => [...entries.values()]);
  };
  debug.__gmWebglCanvases = () => [...webglCanvases].filter((canvas) => canvas.isConnected);
  debug.__gmWebglDraws = () =>
    [...webglCanvases].map((canvas) => ({
      canvas,
      count: webglDraws.get(canvas)?.count ?? 0,
      unsupported: webglDraws.get(canvas)?.unsupported === true || webglExtensions.has(canvas),
    }));
  debug.__gmBeginUiFrame = () => webglDraws.clear();
  let animations: Animation[] = [];
  debug.__gmCapturePause = () => {
    paused = true;
    debug.__gmCapturePausedAt = performance.now();
    for (const entry of frames.values())
      if (entry.native !== undefined) {
        nativeCancel(entry.native);
        entry.native = undefined;
      }
    animations = document.getAnimations().filter((animation) => animation.playState === 'running');
    for (const animation of animations) animation.pause();
  };
  debug.__gmCaptureResume = () => {
    for (const animation of animations) animation.play();
    animations = [];
    delete debug.__gmCapturePausedAt;
    paused = false;
    for (const id of frames.keys()) schedule(id);
  };
  debug.__gmCaptureVersion = () => {
    if (observer.takeRecords().some(relevant)) version++;
    return version;
  };
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options: ShadowRootInit) {
    const root = attach.call(this, options);
    roots.set(this, root);
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    return root;
  };
}
