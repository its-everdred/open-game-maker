// Opaque preview frames cannot access persistent browser storage. Older SDKs probe these APIs before falling back,
// so hide the throwing getters and give ordinary localStorage callers a per-frame, in-memory store.
export const PREVIEW_BOOTSTRAP = `(() => {
  const entries = new Map();
  const local = {
    get length() { return entries.size; },
    key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(String(key)) ?? null; },
    setItem(key, value) { entries.set(String(key), String(value)); },
    removeItem(key) { entries.delete(String(key)); },
    clear() { entries.clear(); },
  };
  for (const [key, value] of [['caches', undefined], ['indexedDB', undefined], ['localStorage', local]]) {
    try { Object.defineProperty(window, key, { value, configurable: false }); } catch {}
  }
  window.fetch = window.fetch.bind(window);
  try { Object.defineProperty(navigator, 'locks', { value: undefined, configurable: false }); } catch {}
})();`;

export const PREVIEW_BOOTSTRAP_FILE = '__ogm_preview_bootstrap.js';

/** Run the isolation shim before every script in the game, even if it omitted a head element. */
export function bootstrapPreviewHtml(html: string): string {
  const script = `<script src="./${PREVIEW_BOOTSTRAP_FILE}"></script>`;
  const doctype = /^\s*<!doctype[^>]*>/iu.exec(html);
  return doctype ? `${html.slice(0, doctype[0].length)}${script}${html.slice(doctype[0].length)}` : script + html;
}
