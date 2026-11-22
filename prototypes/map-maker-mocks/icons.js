window.IC = {
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo:'<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  close:'<path d="M18 6 6 18M6 6l12 12"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  select:'<path d="m4 4 7 16 2-7 7-2z"/>',
  brush:'<path d="M9.06 11.9 17.5 3.5a2.1 2.1 0 1 1 3 3l-8.43 8.4"/><path d="M7 14c-1.66 0-3 1.34-3 3 0 1.31-2 2-2 2 .92 1.22 2.49 2 4 2 2.21 0 4-1.79 4-4 0-1.66-1.34-3-3-3z"/>',
  fence:'<path d="M4 21V7l2-3 2 3v14M16 21V7l2-3 2 3v14M4 11h16M4 17h16"/>',
  erase:'<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21"/><path d="M22 21H7M5 11l9 9"/>',
  rotate:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  flip:'<path d="M12 3v18"/><path d="m16 7 4 5-4 5zM8 7l-4 5 4 5z"/>',
  dup:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  layers:'<path d="m12 2 10 6-10 6L2 8z"/><path d="m2 14 10 6 10-6"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.7M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.3-1"/>',
  lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  ground:'<path d="m12 4 9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  tree:'<path d="M12 22v-6"/><path d="M12 2 5 12h4l-3 4h12l-3-4h4z"/>',
  person:'<circle cx="12" cy="6" r="3"/><path d="M6 21v-5a6 6 0 0 1 12 0v5"/>',
  roof:'<path d="m3 12 9-8 9 8M5 10v10h14V10"/>',
  play:'<path d="M7 4v16l13-8z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
  bulb:'<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  focus:'<circle cx="12" cy="12" r="3"/><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>',
  sparkle:'<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path d="M19 3v4M17 5h4"/>',
  map:'<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  bot:'<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M8 13h.01M16 13h.01"/>',
  filter:'<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  chest:'<rect x="3" y="9" width="18" height="11" rx="1"/><path d="M3 9a9 4 0 0 1 18 0M12 12v3"/>',
  door:'<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M3 21h18M14 12h.01"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  magnet:'<path d="M6 15V7a6 6 0 0 1 12 0v8"/><path d="M6 15h4M14 15h4M6 11h4M14 11h4"/>',
};
window.ic = (n) => `<svg viewBox="0 0 24 24">${IC[n]}</svg>`;
window.btn = (n, cls = '', label = n) => `<button class="btn ${cls}" aria-label="${label}">${ic(n)}</button>`;
// Mini iso preview of a piece inside a thumb (fences as a corner pair, props as a single sprite on a tile).
window.mini = function (spec, on, h = 80, label = '') {
  const id = 'm' + Math.random().toString(36).slice(2);
  setTimeout(() => {
    const el = document.getElementById(id); if (!el) return;
    const s = h / 150, ox = el.clientWidth / 2, oy = h * 0.42;
    if (spec.fence) { Iso.img(el, 'sprites/ground_a2_e.png', 0, 0, ox, oy, s, 'g'); Iso.fence(el, spec.fence, 0, 0, 'xMin', ox, oy, s); Iso.fence(el, spec.fence, 0, 0, 'yMin', ox, oy, s); }
    else if (spec.wall) { Iso.img(el, 'sprites/ground_a2_e.png', 0, 0, ox, oy, s, 'g'); Iso.img(el, `sprites/${spec.wall}.png`, 0, 0, ox, oy, s, 'f'); }
    else if (spec.ground) { Iso.img(el, `sprites/${spec.ground}.png`, 0, 0, ox, oy - 10 * s, s * 1.2, 'g'); }
    else if (spec.char) { Iso.img(el, `sprites/${spec.char}.png`, 0, 0, ox, oy + 40 * s, s * 2.6, 'c'); }
    else { Iso.img(el, 'sprites/ground_a2_e.png', 0, 0, ox, oy, s, 'g'); Iso.img(el, `sprites/${spec.prop}.png`, 0, 0, ox, oy, s, 'f'); }
  });
  return `<div class="tile ${on ? 'on' : ''}" style="height:${h}px"><div id="${id}" style="position:absolute;inset:0;z-index:0"></div></div>`;
};
