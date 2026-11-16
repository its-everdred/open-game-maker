/** Bump the filename and host query together whenever this immutable, non-sensitive observer changes. */
export const FRAME_OBSERVER_FILE = '__ogm_frame_observer_v2.js';
export const FRAME_OBSERVER = `(() => {
  let sent = false;
  const originals = [];
  const pending = new Set();
  const observer = new MutationObserver(() => {
    for (const canvas of pending) if (visibleCanvas(canvas)) { signal(true); break; }
  });
  observer.observe(document, { childList: true, subtree: true, attributes: true });
  function visibleCanvas(canvas) {
    if (!canvas.isConnected) return false;
    const bounds = canvas.getBoundingClientRect();
    let visible = bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight;
    for (let node = canvas; visible && node; node = node.parentElement) {
      const style = getComputedStyle(node);
      visible = style.visibility === 'visible' && Number(style.opacity) > 0;
    }
    return visible;
  }
  function signal(drawn = false) {
    if (sent) return;
    sent = true;
    observer.disconnect();
    pending.clear();
    for (const [prototype, name, original, wrapped] of originals) {
      try { if (prototype[name] === wrapped) prototype[name] = original; } catch {}
    }
    if (drawn) {
      window.__ogmObservedFrame = true;
      window.dispatchEvent(new Event('ogm-observed-frame'));
    }
    window.parent.postMessage({ type: 'ogm.frame.ready.v2' }, '*');
  }
  window.addEventListener('gm-frame-ready', () => signal(), { once: true });
  const paths = new WeakSet();
  const points = new WeakMap();
  if (window.Path2D) {
    const NativePath = window.Path2D;
    const wrapped = new Proxy(NativePath, { construct(target, args, newTarget) {
      const path = Reflect.construct(target, args, newTarget);
      if ((typeof args[0] === 'string' && args[0].trim()) || paths.has(args[0])) paths.add(path);
      return path;
    }});
    try { window.Path2D = wrapped; if (window.Path2D === wrapped) originals.push([window, 'Path2D', NativePath, wrapped]); } catch {}
  }
  // Track path construction so an empty fill or stroke is not mistaken for a rendered frame.
  for (const constructor of [window.CanvasRenderingContext2D, window.Path2D]) {
    if (!constructor) continue;
    for (const name of ['beginPath', 'moveTo', 'lineTo', 'rect', 'roundRect', 'arc', 'arcTo', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'addPath']) {
      const prototype = constructor.prototype;
      if (!Object.prototype.hasOwnProperty.call(prototype, name)) continue;
      const original = prototype[name];
      if (typeof original !== 'function') continue;
      const wrapped = function (...args) {
        const result = original.apply(this, args);
        if (name === 'beginPath') { paths.delete(this); points.delete(this); }
        else if (name === 'addPath') { if (paths.has(args[0])) paths.add(this); }
        else if (name === 'moveTo' || name === 'lineTo') {
          const previous = points.get(this);
          if (name === 'lineTo' && previous && (previous[0] !== args[0] || previous[1] !== args[1])) paths.add(this);
          points.set(this, [args[0], args[1]]);
        } else {
          const previous = points.get(this);
          const paints = ((name !== 'rect' && name !== 'roundRect') || (args[2] && args[3])) &&
            (name !== 'arc' || (args[2] > 0 && args[3] !== args[4])) &&
            (name !== 'ellipse' || (args[2] > 0 && args[3] > 0 && args[5] !== args[6])) &&
            (name !== 'arcTo' || !!previous);
          if (paints) paths.add(this);
          points.set(this, [NaN, NaN]);
        }
        return result;
      };
      try { prototype[name] = wrapped; if (prototype[name] === wrapped) originals.push([prototype, name, original, wrapped]); } catch {}
    }
  }
  // Older SDKs have no ready event. Observe the first drawing operation on a visible, connected game canvas.
  for (const [constructor, names] of [
    [window.CanvasRenderingContext2D, ['drawImage', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'putImageData', 'fill', 'stroke']],
    [window.WebGLRenderingContext, ['drawArrays', 'drawElements']],
    [window.WebGL2RenderingContext, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']],
  ]) {
    if (!constructor) continue;
    for (const name of names) {
      const prototype = constructor.prototype;
      if (!Object.prototype.hasOwnProperty.call(prototype, name)) continue;
      const original = prototype[name];
      if (typeof original !== 'function') continue;
      const wrapped = function (...args) {
        const result = original.apply(this, args);
        if (sent) return result;
        try {
        // Calls with no vertices, instances, text, or destination area cannot paint a frame.
        const nonpositive = (value) => typeof value === 'number' && value <= 0;
        if ((name === 'fill' || name === 'stroke') && !paths.has(window.Path2D && args[0] instanceof window.Path2D ? args[0] : this)) return result;
        if ((name === 'drawArrays' || name === 'drawArraysInstanced') && (nonpositive(args[2]) || (name === 'drawArraysInstanced' && nonpositive(args[3])))) return result;
        if ((name === 'drawElements' || name === 'drawElementsInstanced') && (nonpositive(args[1]) || (name === 'drawElementsInstanced' && nonpositive(args[4])))) return result;
        if ((name === 'fillRect' || name === 'strokeRect') && (!args[2] || !args[3])) return result;
        if ((name === 'fillText' || name === 'strokeText') && ((typeof args[0] === 'string' && !args[0]) || (args.length > 3 && nonpositive(args[3])))) return result;
        if (name === 'drawImage') {
          const source = args[0];
          const width = source?.videoWidth ?? source?.naturalWidth ?? source?.width;
          const height = source?.videoHeight ?? source?.naturalHeight ?? source?.height;
          if ((typeof width === 'number' && width <= 0) || (typeof height === 'number' && height <= 0) || (args.length === 5 && (!args[3] || !args[4])) || (args.length === 9 && (!args[3] || !args[4] || !args[7] || !args[8]))) return result;
        }
        if (name !== 'putImageData' && typeof this.globalAlpha === 'number' && this.globalAlpha <= 0) return result;
        if (name === 'putImageData' && (!args[0]?.width || !args[0]?.height || (args.length >= 7 && (!args[5] || !args[6])))) return result;
          const canvas = this.canvas;
          if (canvas instanceof HTMLCanvasElement) {
            // A WebGL shadow/offscreen pass is not a frame on the game canvas.
            if (typeof this.getParameter === 'function' && this.getParameter(this.DRAW_FRAMEBUFFER_BINDING ?? this.FRAMEBUFFER_BINDING) !== null) return result;
            if (visibleCanvas(canvas)) signal(true);
            else pending.add(canvas);
          }
        } catch {}
        return result;
      };
      try { prototype[name] = wrapped; if (prototype[name] === wrapped) originals.push([prototype, name, original, wrapped]); } catch {}
    }
  }
})();`;

/** Install before the game's scripts so existing SDK builds can report their first rendered frame. */
export function observeFrameHtml(html: string): string {
  const script = `<script src="./${FRAME_OBSERVER_FILE}"></script>`;
  const doctype = /^\s*<!doctype[^>]*>/iu.exec(html);
  return doctype ? `${html.slice(0, doctype[0].length)}${script}${html.slice(doctype[0].length)}` : script + html;
}
