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
  grid:'<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
  ground:'<path d="m12 4 9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  tree:'<path d="M12 22v-6"/><path d="M12 2 5 12h4l-3 4h12l-3-4h4z"/>',
  stone:'<path d="M7 21V9a5 5 0 0 1 10 0v12z"/><path d="M4 21h16"/>',
  person:'<circle cx="12" cy="6" r="3"/><path d="M6 21v-5a6 6 0 0 1 12 0v5"/>',
  wall:'<path d="M3 5h18v14H3zM3 12h18M9 5v7M15 12v7"/>',
  roof:'<path d="m3 12 9-8 9 8M5 10v10h14V10"/>',
  play:'<path d="M7 4v16l13-8z"/>',
  scatter:'<circle cx="6" cy="7" r="2"/><circle cx="17" cy="6" r="2"/><circle cx="11" cy="13" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="17" r="2"/>',
  magnet:'<path d="M6 15V7a6 6 0 0 1 12 0v8"/><path d="M6 15h4M14 15h4M6 11h4M14 11h4"/>',
};
window.ic = (n) => `<svg viewBox="0 0 24 24">${IC[n]}</svg>`;
window.btn = (n, cls = '', label = n) => `<button class="btn ${cls}" aria-label="${label}">${ic(n)}</button>`;
window.thumb = (src, on, kind = 'img') => kind === 'char'
  ? `<div class="tile ${on ? 'on' : ''}"><div class="sheet" style="background-image:url(${src});background-size:400% 800%;background-position:0 28.57%"></div></div>`
  : `<div class="tile ${on ? 'on' : ''}"><img class="${/fence_/.test(src) ? 'tall' : ''}" src="${src}" alt=""></div>`;
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
