// Tiny iso renderer for the mocks. Tile 128x64 at scale 1.
window.Iso = {
  pos(x, y, ox, oy, s) { return [ox + (x - y) * 64 * s, oy + (x + y) * 32 * s]; },
  // kind: 'g' ground / 'f' fantasy prop, 256x256 images whose 128x64 tile sits 160px down; 'c' character sheet (4x8, 128px frames).
  img(layer, src, x, y, ox, oy, s, kind = 'f', extra = '') {
    const [px, py] = this.pos(x, y, ox, oy, s);
    const el = document.createElement('div');
    const z = Math.round((x + y) * 100 + (kind === 'g' ? -100000 : 0) + (kind === 'c' ? 50 : 0));
    let w, h, top;
    if (kind === 'g' || kind === 'f') { w = 256 * s; h = 256 * s; top = py - 160 * s; }
    if (kind === 'c') { w = 96 * s; h = 96 * s; top = py - 64 * s; }
    el.style.cssText = `position:absolute;left:${px - w / 2}px;top:${top}px;width:${w}px;height:${h}px;z-index:${z};${extra}`;
    if (kind === 'c') {
      el.style.backgroundImage = `url(${src})`;
      el.style.backgroundSize = `${4 * w}px ${8 * h}px`;
      el.style.backgroundPosition = `0 ${-2 * h}px`; // row 2 = S facing
      el.style.imageRendering = 'pixelated';
    } else {
      const i = document.createElement('img'); i.src = src;
      i.style.cssText = 'width:100%;height:100%;image-rendering:pixelated;display:block';
      el.appendChild(i);
    }
    layer.appendChild(el);
    return el;
  },
  diamond(layer, x, y, ox, oy, s, css) {
    const [px, py] = this.pos(x, y, ox, oy, s);
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:${px - 64 * s}px;top:${py}px;width:${128 * s}px;height:${64 * s}px;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);z-index:${Math.round((x + y) * 100 - 50000)};${css}`;
    layer.appendChild(el);
    return el;
  },
};
// Rural HD tiles: 128x256 at 1:1, the tile diamond is the image's bottom 64px; each facing draws one edge.
Iso.EDGE_FACING = { yMin: 'w', xMin: 's', xMax: 'n', yMax: 'e' };
Iso.rural = function (layer, file, x, y, ox, oy, s, zb = 0, extra = '') {
  const [px, py] = this.pos(x, y, ox, oy, s);
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;left:${px - 64 * s}px;top:${py - 152 * s}px;width:${128 * s}px;height:${256 * s}px;z-index:${Math.round((x + y) * 100 + zb)};${extra}`;
  el.innerHTML = `<img src="sprites/${file}.png" style="width:100%;height:100%;display:block">`;
  layer.appendChild(el); return el;
};
Iso.fence = function (layer, fam, x, y, edge, ox, oy, s, extra = '') {
  return this.rural(layer, `fence_${fam}_${this.EDGE_FACING[edge]}`, x, y, ox, oy, s, edge === 'xMax' || edge === 'yMax' ? 40 : -40, extra);
};
