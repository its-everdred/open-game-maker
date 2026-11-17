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
  for (const name of ['insertRule', 'deleteRule', 'replaceSync'] as const) {
    const original = CSSStyleSheet.prototype[name];
    if (typeof original !== 'function') continue;
    Object.defineProperty(CSSStyleSheet.prototype, name, {
      configurable: true,
      writable: true,
      value: function (this: CSSStyleSheet, ...args: unknown[]) {
        const result = Reflect.apply(original, this, args);
        version++;
        return result;
      },
    });
  }
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
    unverifiedClip: boolean;
    unverifiedComposite?: boolean;
  };
  const canvasDraws = new Map<HTMLCanvasElement, Map<string, Draw>>();
  type Bounds = { left: number; top: number; right: number; bottom: number };
  const clipBounds = new WeakMap<CanvasRenderingContext2D, Bounds>();
  const contexts2d = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  const pathBounds = new WeakMap<CanvasRenderingContext2D, Bounds>();
  const rectangularPaths = new WeakSet<CanvasRenderingContext2D>();
  const uncertainPaths = new WeakSet<CanvasRenderingContext2D>();
  const boundsStack = new WeakMap<CanvasRenderingContext2D, (Bounds | undefined)[]>();
  const patternedCanvases = new Set<HTMLCanvasElement>();
  const gradients = new WeakMap<CanvasGradient, { hasStop: boolean; opaque: boolean }>();
  for (const name of ['createLinearGradient', 'createRadialGradient', 'createConicGradient'] as const) {
    const original = CanvasRenderingContext2D.prototype[name];
    if (typeof original !== 'function') continue;
    Object.defineProperty(CanvasRenderingContext2D.prototype, name, {
      configurable: true,
      writable: true,
      value: function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        const gradient = Reflect.apply(original, this, args) as CanvasGradient;
        gradients.set(gradient, { hasStop: false, opaque: true });
        return gradient;
      },
    });
  }
  const originalColorStop = CanvasGradient.prototype.addColorStop;
  CanvasGradient.prototype.addColorStop = function (offset, color) {
    originalColorStop.call(this, offset, color);
    const state = gradients.get(this);
    if (!state) return;
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const context = probe.getContext('2d')!;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    state.hasStop = true;
    state.opaque &&= context.getImageData(0, 0, 1, 1).data[3] === 255;
  };
  const webglCanvases = new Set<HTMLCanvasElement>();
  const transferredCanvases = new Set<HTMLCanvasElement>();
  const transfer = HTMLCanvasElement.prototype.transferControlToOffscreen;
  if (transfer)
    HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
      const result = transfer.call(this);
      transferredCanvases.add(this);
      return result;
    };
  const webglDraws = new Map<HTMLCanvasElement, { count: number; unsupported: boolean }>();
  const webglExtensions = new Set<HTMLCanvasElement>();
  const wrappedExtensions = new WeakSet<object>();
  const visibleCanvas = (canvas: HTMLCanvasElement) => {
    if (!canvas.isConnected) return false;
    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    return style.display !== 'none' && style.visibility === 'visible' && rect.width > 0 && rect.height > 0;
  };
  const originalContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
    const context = Reflect.apply(originalContext, this, [kind, ...args]);
    if (context instanceof CanvasRenderingContext2D) contexts2d.set(this, context);
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
          if (name === 'clear') {
            const gl = this as WebGLRenderingContext | WebGL2RenderingContext;
            if (
              gl.canvas instanceof HTMLCanvasElement &&
              (Number(args[0]) & gl.COLOR_BUFFER_BIT) !== 0 &&
              gl.getParameter(gl.FRAMEBUFFER_BINDING) === null &&
              !gl.isEnabled(gl.SCISSOR_TEST) &&
              (gl.getParameter(gl.COLOR_WRITEMASK) as boolean[]).every(Boolean)
            ) {
              webglDraws.delete(gl.canvas);
              webglExtensions.delete(gl.canvas);
            }
          }
          if (name.startsWith('draw') || name === 'blitFramebuffer') {
            const gl = this as WebGLRenderingContext | WebGL2RenderingContext;
            const canvas = gl.canvas;
            if (canvas instanceof HTMLCanvasElement) {
              const entry = webglDraws.get(canvas) ?? { count: 0, unsupported: false };
              const mode = Number(args[0]);
              const count = Number(args[name === 'drawRangeElements' ? 3 : name.startsWith('drawArrays') ? 2 : 1]);
              const instances = name.endsWith('Instanced') ? Number(args[name.startsWith('drawArrays') ? 3 : 4]) : 1;
              const quads =
                mode === gl.TRIANGLES && count > 0 && count % 6 === 0
                  ? count / 6
                  : (mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN) && count === 4
                    ? 1
                    : 0;
              if (name === 'blitFramebuffer' || (count !== 0 && instances !== 0)) {
                entry.count += quads * instances;
                entry.unsupported ||=
                  name === 'drawRangeElements' ||
                  name === 'blitFramebuffer' ||
                  quads === 0 ||
                  !Number.isFinite(instances) ||
                  instances < 0;
              }
              webglDraws.set(canvas, entry);
            }
          }
          const canvas = (this as WebGLRenderingContext).canvas;
          const countIndex = name === 'drawRangeElements' ? 3 : name.startsWith('drawArrays') ? 2 : 1;
          const empty =
            name.startsWith('draw') &&
            (Number(args[countIndex]) === 0 ||
              (name.endsWith('Instanced') && Number(args[name.startsWith('drawArrays') ? 3 : 4]) === 0));
          if (!empty && canvas instanceof HTMLCanvasElement && visibleCanvas(canvas)) version++;
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
            this.canvas instanceof HTMLCanvasElement &&
            !wrappedExtensions.has(result as object)
          ) {
            wrappedExtensions.add(result as object);
            const canvas = this.canvas;
            const triangles = this.TRIANGLES;
            const strip = this.TRIANGLE_STRIP;
            const fan = this.TRIANGLE_FAN;
            for (const key of [
              'drawArraysInstancedANGLE',
              'drawElementsInstancedANGLE',
              'multiDrawArraysWEBGL',
              'multiDrawElementsWEBGL',
              'multiDrawArraysInstancedWEBGL',
              'multiDrawElementsInstancedWEBGL',
            ]) {
              const originalMethod = (result as Record<string, unknown>)[key];
              if (typeof originalMethod !== 'function') continue;
              (result as Record<string, unknown>)[key] = function (...callArgs: unknown[]) {
                if (key.endsWith('ANGLE')) {
                  const mode = Number(callArgs[0]);
                  const count = Number(callArgs[key.startsWith('drawArrays') ? 2 : 1]);
                  const instances = Number(callArgs[key.startsWith('drawArrays') ? 3 : 4]);
                  const quads =
                    mode === triangles && count > 0 && count % 6 === 0
                      ? count / 6
                      : (mode === strip || mode === fan) && count === 4
                        ? 1
                        : 0;
                  const entry = webglDraws.get(canvas) ?? { count: 0, unsupported: false };
                  if (count !== 0 && instances !== 0) {
                    entry.count += quads * instances;
                    entry.unsupported ||= quads === 0 || !Number.isFinite(instances) || instances < 0;
                  }
                  webglDraws.set(canvas, entry);
                } else webglExtensions.add(canvas);
                const empty =
                  key.endsWith('ANGLE') &&
                  (Number(callArgs[key.startsWith('drawArrays') ? 2 : 1]) === 0 ||
                    Number(callArgs[key.startsWith('drawArrays') ? 3 : 4]) === 0);
                if (!empty && visibleCanvas(canvas)) version++;
                return Reflect.apply(originalMethod, result, callArgs);
              };
            }
          }
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
    const sourceWidth =
      typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas
        ? 0
        : args.length === 8
          ? args[2]!
          : naturalWidth;
    const sourceHeight = args.length === 8 ? args[3]! : naturalHeight;
    const drawnWidth = args.length === 8 ? args[6]! : args.length === 4 ? args[2]! : sourceWidth;
    const drawnHeight = args.length === 8 ? args[7]! : args.length === 4 ? args[3]! : sourceHeight;
    if (drawnWidth === 0 || drawnHeight === 0 || (args.length === 8 && (args[2] === 0 || args[3] === 0))) return;
    if (this.globalAlpha === 0 && this.globalCompositeOperation === 'source-over') return;
    if (visibleCanvas(this.canvas)) version++;
    if (this.globalCompositeOperation === 'copy') {
      const entries = canvasDraws.get(this.canvas);
      if (!clippedContexts.has(this)) canvasDraws.delete(this.canvas);
      else if (entries) for (const draw of entries.values()) draw.unverifiedComposite = true;
    }
    if (this.globalCompositeOperation === 'destination-out' || this.globalCompositeOperation === 'destination-in') {
      const entries = canvasDraws.get(this.canvas);
      if (entries?.size) {
        const x = args.length === 8 ? args[4]! : args[0]!;
        const y = args.length === 8 ? args[5]! : args[1]!;
        let erased = false;
        if (
          this.globalCompositeOperation === 'destination-out' &&
          this.globalAlpha === 1 &&
          !clippedContexts.has(this) &&
          this.getTransform().isIdentity &&
          x <= 0 &&
          y <= 0 &&
          drawnWidth >= this.canvas.width &&
          drawnHeight >= this.canvas.height &&
          image instanceof HTMLCanvasElement &&
          image !== this.canvas &&
          args.length !== 8 &&
          image.width * image.height <= 4_000_000
        ) {
          try {
            const pixels = contexts2d.get(image)?.getImageData(0, 0, image.width, image.height).data;
            erased = !!pixels && pixels.length > 0 && pixels.every((value, index) => index % 4 !== 3 || value === 255);
          } catch {
            /* Cross-origin or otherwise unreadable masks stay unverified. */
          }
        }
        if (erased) canvasDraws.delete(this.canvas);
        else for (const draw of entries.values()) draw.unverifiedComposite = true;
      }
      return;
    }
    const matrix = this.getTransform();
    const x = args.length === 8 ? args[4]! : args[0]!;
    const y = args.length === 8 ? args[5]! : args[1]!;
    const corners = [
      new DOMPoint(x, y),
      new DOMPoint(x + drawnWidth, y),
      new DOMPoint(x, y + drawnHeight),
      new DOMPoint(x + drawnWidth, y + drawnHeight),
    ].map((point) => point.matrixTransform(matrix));
    const clip = clipBounds.get(this);
    if (
      this.globalAlpha === 0 ||
      (clip &&
        (corners.every((point) => point.x <= clip.left) ||
          corners.every((point) => point.x >= clip.right) ||
          corners.every((point) => point.y <= clip.top) ||
          corners.every((point) => point.y >= clip.bottom))) ||
      corners.every((point) => point.x <= 0) ||
      corners.every((point) => point.y <= 0) ||
      corners.every((point) => point.x >= this.canvas.width) ||
      corners.every((point) => point.y >= this.canvas.height)
    )
      return;
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
      unverifiedClip: unknownClips.has(this),
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
      draw.unverifiedClip,
    ]);
    if (entries.size >= 10_000 && !entries.has(key)) {
      entries.set('__overflow__', { ...draw, sourceWidth: 0, sourceHeight: 0 });
    } else entries.set(key, draw);
  } as typeof CanvasRenderingContext2D.prototype.drawImage;
  const originalClear = CanvasRenderingContext2D.prototype.clearRect;
  const clippedContexts = new WeakSet<CanvasRenderingContext2D>();
  const unknownClips = new WeakSet<CanvasRenderingContext2D>();
  const unknownClipStack = new WeakMap<CanvasRenderingContext2D, boolean[]>();
  const clipStack = new WeakMap<CanvasRenderingContext2D, boolean[]>();
  const originalSave = CanvasRenderingContext2D.prototype.save;
  const originalRestore = CanvasRenderingContext2D.prototype.restore;
  CanvasRenderingContext2D.prototype.save = function () {
    const stack = clipStack.get(this) ?? [];
    stack.push(clippedContexts.has(this));
    clipStack.set(this, stack);
    const unknown = unknownClipStack.get(this) ?? [];
    unknown.push(unknownClips.has(this));
    unknownClipStack.set(this, unknown);
    const bounds = boundsStack.get(this) ?? [];
    bounds.push(clipBounds.get(this));
    boundsStack.set(this, bounds);
    originalSave.call(this);
  };
  CanvasRenderingContext2D.prototype.restore = function () {
    const stack = clipStack.get(this);
    if (stack?.length) {
      if (stack.pop()) clippedContexts.add(this);
      else clippedContexts.delete(this);
    }
    const unknown = unknownClipStack.get(this);
    if (unknown?.length) {
      if (unknown.pop()) unknownClips.add(this);
      else unknownClips.delete(this);
    }
    const bounds = boundsStack.get(this);
    if (bounds?.length) {
      const previous = bounds.pop();
      if (previous) clipBounds.set(this, previous);
      else clipBounds.delete(this);
    }
    originalRestore.call(this);
  };
  const originalClip = CanvasRenderingContext2D.prototype.clip;
  const originalBeginPath = CanvasRenderingContext2D.prototype.beginPath;
  CanvasRenderingContext2D.prototype.beginPath = function () {
    rectangularPaths.add(this);
    uncertainPaths.delete(this);
    pathBounds.delete(this);
    originalBeginPath.call(this);
  };
  const originalRect = CanvasRenderingContext2D.prototype.rect;
  CanvasRenderingContext2D.prototype.rect = function (x, y, width, height) {
    if (rectangularPaths.has(this)) {
      const matrix = this.getTransform();
      if (pathBounds.has(this) || matrix.b !== 0 || matrix.c !== 0) uncertainPaths.add(this);
      const points = [
        new DOMPoint(x, y),
        new DOMPoint(x + width, y),
        new DOMPoint(x, y + height),
        new DOMPoint(x + width, y + height),
      ].map((point) => point.matrixTransform(matrix));
      const old = pathBounds.get(this);
      pathBounds.set(this, {
        left: Math.min(old?.left ?? Infinity, ...points.map((point) => point.x)),
        top: Math.min(old?.top ?? Infinity, ...points.map((point) => point.y)),
        right: Math.max(old?.right ?? -Infinity, ...points.map((point) => point.x)),
        bottom: Math.max(old?.bottom ?? -Infinity, ...points.map((point) => point.y)),
      });
    }
    originalRect.call(this, x, y, width, height);
  };
  for (const name of [
    'moveTo',
    'lineTo',
    'arc',
    'arcTo',
    'ellipse',
    'bezierCurveTo',
    'quadraticCurveTo',
    'roundRect',
  ] as const) {
    const original = CanvasRenderingContext2D.prototype[name];
    if (typeof original !== 'function') continue;
    Object.defineProperty(CanvasRenderingContext2D.prototype, name, {
      configurable: true,
      writable: true,
      value: function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        rectangularPaths.delete(this);
        return Reflect.apply(original, this, args);
      },
    });
  }
  CanvasRenderingContext2D.prototype.clip = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
    Reflect.apply(originalClip, this, args);
    clippedContexts.add(this);
    const path =
      typeof args[0] === 'object' ? undefined : rectangularPaths.has(this) ? pathBounds.get(this) : undefined;
    if (!path || uncertainPaths.has(this)) unknownClips.add(this);
    if (path) {
      const old = clipBounds.get(this);
      clipBounds.set(
        this,
        old
          ? {
              left: Math.max(old.left, path.left),
              top: Math.max(old.top, path.top),
              right: Math.min(old.right, path.right),
              bottom: Math.min(old.bottom, path.bottom),
            }
          : path,
      );
    }
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
    ) {
      canvasDraws.delete(this.canvas);
      patternedCanvases.delete(this.canvas);
    }
    originalClear.call(this, x, y, width, height);
    if (visibleCanvas(this.canvas)) version++;
  };
  const originalFill = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
    const style = this.fillStyle;
    if (
      !clippedContexts.has(this) &&
      this.getTransform().isIdentity &&
      this.globalAlpha === 1 &&
      (this.globalCompositeOperation === 'source-over' || this.globalCompositeOperation === 'copy') &&
      ((typeof style === 'string' && (/^#[0-9a-f]{6}$/i.test(style) || /^rgb\(/i.test(style))) ||
        (style instanceof CanvasGradient &&
          gradients.get(style)?.hasStop === true &&
          gradients.get(style)?.opaque === true)) &&
      x <= 0 &&
      y <= 0 &&
      width >= this.canvas.width &&
      height >= this.canvas.height
    ) {
      canvasDraws.delete(this.canvas);
      patternedCanvases.delete(this.canvas);
    }
    if (style instanceof CanvasPattern) patternedCanvases.add(this.canvas);
    originalFill.call(this, x, y, width, height);
    if (visibleCanvas(this.canvas)) version++;
  };
  for (const name of ['fill', 'stroke', 'strokeRect', 'fillText', 'strokeText', 'putImageData', 'reset'] as const) {
    const original = CanvasRenderingContext2D.prototype[name];
    if (typeof original !== 'function') continue;
    Object.defineProperty(CanvasRenderingContext2D.prototype, name, {
      configurable: true,
      writable: true,
      value: function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        const result = Reflect.apply(original, this, args);
        if (name === 'putImageData' && args[0] instanceof ImageData) {
          const pixels = args[0];
          const width = args.length >= 7 ? Math.abs(Number(args[5])) : pixels.width;
          const height = args.length >= 7 ? Math.abs(Number(args[6])) : pixels.height;
          if (width > 0 && height > 0) {
            const entries = canvasDraws.get(this.canvas) ?? new Map<string, Draw>();
            const draw: Draw = {
              canvas: this.canvas,
              file: 'pixel buffer',
              sourceWidth: width,
              sourceHeight: height,
              drawnWidth: width,
              drawnHeight: height,
              a: 1,
              b: 0,
              c: 0,
              d: 1,
              unverifiedClip: false,
            };
            entries.set(`pixel:${width}:${height}`, draw);
            canvasDraws.set(this.canvas, entries);
          }
        }
        if (name === 'reset') {
          canvasDraws.delete(this.canvas);
          patternedCanvases.delete(this.canvas);
          clippedContexts.delete(this);
          unknownClips.delete(this);
          unknownClipStack.delete(this);
          clipStack.delete(this);
          clipBounds.delete(this);
          boundsStack.delete(this);
          pathBounds.delete(this);
          rectangularPaths.delete(this);
          uncertainPaths.delete(this);
        }
        const style = name.startsWith('stroke') ? this.strokeStyle : this.fillStyle;
        if (style instanceof CanvasPattern) patternedCanvases.add(this.canvas);
        if (visibleCanvas(this.canvas)) version++;
        return result;
      },
    });
  }
  for (const key of ['width', 'height'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key);
    if (descriptor?.set && descriptor.configurable)
      Object.defineProperty(HTMLCanvasElement.prototype, key, {
        ...descriptor,
        set(value: number) {
          canvasDraws.delete(this as HTMLCanvasElement);
          patternedCanvases.delete(this as HTMLCanvasElement);
          const context = contexts2d.get(this as HTMLCanvasElement);
          if (context) {
            clippedContexts.delete(context);
            unknownClips.delete(context);
            unknownClipStack.delete(context);
            clipStack.delete(context);
            clipBounds.delete(context);
            boundsStack.delete(context);
            pathBounds.delete(context);
            rectangularPaths.delete(context);
            uncertainPaths.delete(context);
          }
          descriptor.set!.call(this, value);
          if (visibleCanvas(this as HTMLCanvasElement)) version++;
        },
      });
  }
  const debug = window as unknown as {
    __gmShadowRoots: WeakMap<Element, ShadowRoot>;
    __gmCaptureVersion: () => number;
    __gmIgnoreCaptureProbe: (node: Node) => void;
    __gmCanvasDraws: () => Draw[];
    __gmPatternedCanvases: () => HTMLCanvasElement[];
    __gmWebglCanvases: () => HTMLCanvasElement[];
    __gmTransferredCanvases: () => HTMLCanvasElement[];
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
  debug.__gmPatternedCanvases = () => [...patternedCanvases].filter((canvas) => canvas.isConnected);
  debug.__gmTransferredCanvases = () => [...transferredCanvases].filter((canvas) => canvas.isConnected);
  debug.__gmWebglDraws = () =>
    [...webglCanvases].map((canvas) => ({
      canvas,
      count: webglDraws.get(canvas)?.count ?? 0,
      unsupported: webglDraws.get(canvas)?.unsupported === true || webglExtensions.has(canvas),
    }));
  debug.__gmBeginUiFrame = () => {};
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
