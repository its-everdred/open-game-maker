// Shared mock pieces: a big asset library, scene cards and HD-2D "look" controls.
window.LIB = {
  total: '1,876',
  kinds: [['ground', 'Ground'], ['fence', 'Fences'], ['roof', 'Walls'], ['door', 'Doors'], ['tree', 'Nature'], ['chest', 'Props'], ['bulb', 'Lights'], ['person', 'Characters']],
  // Nature is open: finer filters, then labelled thumbnails.
  subs: ['Trees', 'Flora', 'Stones', 'Wall vines'],
  tags: ['Fantasy', 'Rural', 'Dead', 'Tall'],
  items: [
    [{ prop: 'tree_a1_e' }, 'Oak'], [{ prop: 'tree_a3_e' }, 'Birch'], [{ prop: 'tree_b1_e' }, 'Pine'], [{ prop: 'tree_b4_e' }, 'Hedge'],
    [{ prop: 'flora_a5_e' }, 'Fern'], [{ prop: 'flora_a2_e' }, 'Bush'], [{ prop: 'flora_b1_e' }, 'Reeds'], [{ prop: 'wallflora_a1_e' }, 'Ivy'],
    [{ prop: 'stone_a4_e' }, 'Grave'], [{ prop: 'stone_a13_e' }, 'Cross'], [{ prop: 'stone_a5_e' }, 'Slab'], [{ prop: 'misc_a1_e' }, 'Barrel'],
  ],
};
window.kindChip = ([icon, label], on) => `<span class="chip ${on ? 'on' : ''}"><svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round">${IC[icon]}</svg>${label}</span>`;
window.labelled = ([spec, name], on, h) => `<div class="lab">${mini(spec, on, h)}<span>${name}</span></div>`;
// Scene cards: a tiny render of the scene, its name and who last changed it.
window.SCENES = [['Graveyard', 'person', true], ['Village', 'bot', false], ['Crypt', 'bot', false]];
window.sceneCard = ([name, who, on], w, h, i) => {
  const id = 'sc' + Math.random().toString(36).slice(2);
  setTimeout(() => {
    const el = document.getElementById(id); if (!el) return;
    const s = w / 1150; buildScene(el, w / 2 + (i - 1) * 8, h * 0.18, s, { fam: i === 1 ? 'a1' : 'b1' });
    if (i === 2) for (const c of el.children) c.style.filter = 'hue-rotate(200deg) brightness(.7)';
  });
  return `<div class="scard ${on ? 'on' : ''}" style="width:${w}px"><div id="${id}" class="sthumb" style="height:${h}px"></div>
   <div class="sname"><span>${name}</span><span class="who ${who}">${ic(who)}</span></div></div>`;
};
// HD-2D: night tint, torch light pools, tilt-shift blur bands, fireflies.
window.applyLook = function (L, ox, oy, s, VW, VH) {
  const add = (css) => { const d = document.createElement('div'); d.style.cssText = css; L.appendChild(d); return d; };
  Iso.img(L, 'sprites/torch2.png', 3, 6, ox, oy, s, 'f');
  Iso.img(L, 'sprites/torch2.png', 0, 3, ox, oy, s, 'f');
  add('position:absolute;inset:0;z-index:800000;background:rgba(20,24,70,.42);mix-blend-mode:multiply;pointer-events:none');
  for (const [x, y] of [[3.5, 6.5], [0.5, 3.5]]) {
    const [px, py] = Iso.pos(x, y, ox, oy, s), r = 260 * s;
    add(`position:absolute;left:${px - r}px;top:${py - r}px;width:${2 * r}px;height:${2 * r}px;z-index:800001;border-radius:50%;background:radial-gradient(circle,rgba(255,180,80,.55),rgba(255,140,40,.18) 45%,transparent 70%);mix-blend-mode:screen;pointer-events:none`);
  }
  add(`position:absolute;left:0;right:0;top:0;height:${VH * 0.2}px;z-index:800002;backdrop-filter:blur(3px);-webkit-mask:linear-gradient(#000,transparent);mask:linear-gradient(#000,transparent)`);
  add(`position:absolute;left:0;right:0;bottom:0;height:${VH * 0.3}px;z-index:800002;backdrop-filter:blur(3px);-webkit-mask:linear-gradient(transparent,#000);mask:linear-gradient(transparent,#000)`);
  let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 26; i++) add(`position:absolute;left:${VW * (0.15 + rnd() * 0.7)}px;top:${VH * (0.15 + rnd() * 0.45)}px;width:5px;height:5px;border-radius:50%;z-index:800003;background:#e9ff9a;box-shadow:0 0 8px 3px rgba(210,255,120,.7)`);
};
// The look controls: time of day, lights, focus, particles, each a big toggle with one slider.
window.lookControls = (vertical) => `<div class="look ${vertical ? 'vert' : ''}">
  <div class="lk on">${ic('moon')}<input type="range" value="80"></div>
  <div class="lk">${ic('bulb')}<input type="range" value="60"></div>
  <div class="lk">${ic('focus')}<input type="range" value="40"></div>
  <div class="lk">${ic('sparkle')}<input type="range" value="55"></div></div>`;
window.dragGhost = (x, y, spec) => `<div style="position:absolute;left:${x - 50}px;top:${y - 110}px;width:100px;height:100px;z-index:900003;transform:rotate(-6deg);filter:drop-shadow(0 10px 14px rgba(0,0,0,.5))">${mini(spec, true, 100)}</div><div class="finger" style="left:${x}px;top:${y - 40}px"></div>`;
