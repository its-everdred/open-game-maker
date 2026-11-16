/** A versioned, non-sensitive signal from the game frame to its embedding host. */
export const FRAME_OBSERVER_FILE = '__ogm_frame_observer_v1.js';
export const FRAME_OBSERVER = `window.addEventListener('gm-frame-ready', () => {
  window.parent.postMessage({ type: 'ogm.frame.ready.v1' }, '*');
}, { once: true });`;

/** Install before the game's scripts so existing SDK builds can report their first rendered frame. */
export function observeFrameHtml(html: string): string {
  const script = `<script src="./${FRAME_OBSERVER_FILE}"></script>`;
  const doctype = /^\s*<!doctype[^>]*>/iu.exec(html);
  return doctype ? `${html.slice(0, doctype[0].length)}${script}${html.slice(doctype[0].length)}` : script + html;
}
