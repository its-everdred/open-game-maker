/** Bump the filename and host query together whenever this immutable, non-sensitive observer changes. */
export const FRAME_OBSERVER_FILE = '__ogm_frame_observer_v2.js';
export const FRAME_OBSERVER = `(() => {
  let sent = false;
  const originals = [];
  function signal() {
    if (sent) return;
    sent = true;
    for (const [prototype, name, original, wrapped] of originals) {
      try { if (prototype[name] === wrapped) prototype[name] = original; } catch {}
    }
    window.parent.postMessage({ type: 'ogm.frame.ready.v2' }, '*');
  }
  window.addEventListener('gm-frame-ready', signal, { once: true });
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
          const canvas = this.canvas;
          if (canvas instanceof HTMLCanvasElement && canvas.isConnected) {
            // A WebGL shadow/offscreen pass is not a frame on the game canvas.
            if (typeof this.getParameter === 'function' && this.getParameter(this.DRAW_FRAMEBUFFER_BINDING ?? this.FRAMEBUFFER_BINDING) !== null) return result;
            const bounds = canvas.getBoundingClientRect();
            let visible = bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight;
            for (let node = canvas; visible && node; node = node.parentElement) {
              const style = getComputedStyle(node);
              visible = style.visibility === 'visible' && Number(style.opacity) > 0;
            }
            if (visible) signal();
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
