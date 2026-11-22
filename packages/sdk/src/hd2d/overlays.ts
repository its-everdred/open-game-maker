/**
 * Full-screen HD-2D passes drawn as scene objects (the lighting field's overlays). Focus skips them: they are not
 * scene layers, and their huge depth would otherwise squash every real layer's depth band to the front.
 */
export const screenOverlays = new WeakSet<object>();
