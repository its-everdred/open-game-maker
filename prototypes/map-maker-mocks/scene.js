// Graveyard yard from pack sprites. Returns helpers to place UI over tiles.
window.buildScene = function (L, ox, oy, s, opts = {}) {
  const N = 8, M = 7;
  for (let x = 0; x < N; x++) for (let y = 0; y < M; y++) {
    const path = x === 3 || x === 4 ? (y + x) % 3 !== 0 : false;
    Iso.img(L, path ? 'sprites/ground_h1_e.png' : 'sprites/ground_a2_e.png', x, y, ox, oy, s, 'g');
  }
  const gate = (x, y, e) => e === 'yMax' && (x === 3 || x === 4);
  const fam = opts.fam ?? 'b1';
  const skip = opts.skipFence ?? (() => false);
  for (let i = 0; i < N; i++) { if (!skip(i, 0, 'yMin')) Iso.fence(L, fam, i, 0, 'yMin', ox, oy, s); if (!gate(i, M - 1, 'yMax') && !skip(i, M - 1, 'yMax')) Iso.fence(L, fam, i, M - 1, 'yMax', ox, oy, s); }
  for (let i = 0; i < M; i++) { if (!skip(0, i, 'xMin')) Iso.fence(L, fam, 0, i, 'xMin', ox, oy, s); if (!skip(N - 1, i, 'xMax')) Iso.fence(L, fam, N - 1, i, 'xMax', ox, oy, s); }
  const prop = (f, x, y) => Iso.img(L, `sprites/${f}.png`, x, y, ox, oy, s, 'f');
  [[1, 1], [1, 3], [6, 1], [6, 3], [1, 5]].forEach(([x, y], i) => prop(['stone_a4_e', 'stone_a13_e', 'stone_a5_e'][i % 3], x, y));
  [[2, 2], [5, 2], [5, 4]].forEach(([x, y], i) => prop(['stone_a13_e', 'stone_a4_e', 'stone_a5_e'][i % 3], x, y));
  prop('tree_b4_e', 7, 5); prop('tree_a1_e', 0, 0); prop('flora_a5_e', 2, 4);
  Iso.img(L, 'sprites/knight_idle.png', 3.5, 5.2, ox, oy, s, 'c');
  Iso.img(L, 'sprites/warrior_idle.png', 5.6, 2.8, ox, oy, s, 'c');
  return { N, M };
};
window.mark = function (L, x, y, ox, oy, s, css) { return Iso.diamond(L, x, y, ox, oy, s, css); };
window.at = function (x, y, ox, oy, s) { return Iso.pos(x, y, ox, oy, s); };
window.gridLines = function (L, N, M, ox, oy, s, color = 'rgba(111,214,180,.6)') {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:-1000;overflow:visible;pointer-events:none');
  const line = (a, b) => { const l = document.createElementNS(ns, 'line'); const [x1, y1] = Iso.pos(...a, ox, oy, s), [x2, y2] = Iso.pos(...b, ox, oy, s);
    Object.entries({ x1, y1, x2, y2, stroke: color, 'stroke-width': 1.2, 'stroke-dasharray': '4 4' }).forEach(([k, v]) => l.setAttribute(k, v)); svg.appendChild(l); };
  for (let x = 0; x <= N; x++) line([x, 0], [x, M]);
  for (let y = 0; y <= M; y++) line([0, y], [N, y]);
  L.appendChild(svg);
};
