// Game key art and gameplay montages, drawn live from Kenney CC0 sprite sheets (no video files).
// Each scene is fn(ctx, t, W, H) at a logical resolution; pixel scenes run at 320x180, vector scenes at 640x360.

const IMG = {};
const SRC = {
  pp: 'art/pp-tiles.png',
  ppc: 'art/pp-chars.png',
  town: 'art/town.png',
  dun: 'art/dungeon.png',
  shm: 'art/shmup-tiles.png',
  ships: 'art/shmup-ships.png',
  ski: 'art/ski.png',
  bat: 'art/battle.png',
  sp_bg: 'art/space-bg.png',
  sp_ship: 'art/space-playerShip1_blue.png',
  sp_e1: 'art/space-enemyRed1.png',
  sp_e2: 'art/space-enemyBlack3.png',
  sp_e3: 'art/space-enemyGreen2.png',
  sp_m1: 'art/space-meteorBrown_big1.png',
  sp_m2: 'art/space-meteorGrey_med1.png',
  sp_lb: 'art/space-laserBlue01.png',
  sp_lr: 'art/space-laserRed01.png',
  car_r: 'art/race-car_red_1.png',
  car_b: 'art/race-car_blue_1.png',
  car_y: 'art/race-car_yellow_1.png',
  car_g: 'art/race-car_green_1.png',
  trib: 'art/race-tribune_full.png',
  tree: 'art/race-tree_large.png',
  tires: 'art/race-tires_red.png',
  cone: 'art/race-cone_straight.png',
  br_r: 'art/puz-element_red_rectangle_glossy.png',
  br_b: 'art/puz-element_blue_rectangle_glossy.png',
  br_g: 'art/puz-element_green_rectangle_glossy.png',
  br_y: 'art/puz-element_yellow_rectangle_glossy.png',
  br_p: 'art/puz-element_purple_rectangle_glossy.png',
  paddle: 'art/puz-paddleBlu.png',
  ball: 'art/puz-ballBlue.png',
  star: 'art/puz-particleStar.png',
  gc_play: 'art/goblin-play.webp',
  gc_fight: 'art/goblin-fight.webp',
  gc_edit: 'art/goblin-placed.webp',
  gc_win: 'art/goblin-result.webp',
};
export const ready = Promise.all(
  Object.entries(SRC).map(
    ([k, src]) =>
      new Promise((res) => {
        const im = new globalThis.Image();
        im.onload = im.onerror = () => res();
        im.src = '/proto/' + src;
        IMG[k] = im;
      }),
  ),
);

const SHEET = {
  pp: [20, 18],
  ppc: [9, 24],
  town: [12, 16],
  dun: [12, 16],
  shm: [12, 16],
  ships: [4, 32],
  ski: [12, 16],
  bat: [18, 16],
};
function T(c, s, i, x, y, o = {}) {
  const [cols, sz] = SHEET[s],
    im = IMG[s];
  if (!im?.complete || !im.naturalWidth) return;
  const sc = o.s || 1;
  c.save();
  c.translate(Math.round(x), Math.round(y));
  if (o.flip) {
    c.scale(-1, 1);
    c.translate(-sz * sc, 0);
  }
  if (o.rot) {
    c.translate((sz * sc) / 2, (sz * sc) / 2);
    c.rotate(o.rot);
    c.translate((-sz * sc) / 2, (-sz * sc) / 2);
  }
  if (o.a != null) c.globalAlpha = o.a;
  c.drawImage(im, (i % cols) * sz, Math.floor(i / cols) * sz, sz, sz, 0, 0, sz * sc, sz * sc);
  c.restore();
}
function S(c, k, x, y, o = {}) {
  // centred vector sprite
  const im = IMG[k];
  if (!im?.naturalWidth) return;
  const sc = o.s || 1,
    w = im.naturalWidth * sc,
    h = im.naturalHeight * sc;
  c.save();
  c.translate(x, y);
  if (o.rot) c.rotate(o.rot);
  if (o.a != null) c.globalAlpha = o.a;
  c.drawImage(im, -w / 2, -h / 2, w, h);
  c.restore();
}
const rnd = (s) => {
  let x = Math.sin(s * 127.1) * 43758.5453;
  return x - Math.floor(x);
};
const wrap = (v, m) => ((v % m) + m) % m;
function sky(c, W, H, a, b) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}
function cloud(c, x, y, s, col = '#ffffff') {
  c.fillStyle = col;
  [
    [0, 6, 12],
    [10, 0, 14],
    [24, 4, 12],
    [34, 8, 9],
  ].forEach(([dx, dy, r]) => {
    c.beginPath();
    c.arc(x + dx * s, y + dy * s, r * s, 0, 7);
    c.fill();
  });
  c.fillRect(x - 4 * s, y + 6 * s, 44 * s, 9 * s);
}
function hills(c, W, H, off, col, y0, amp, per) {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(0, H);
  for (let x = 0; x <= W; x += 4)
    c.lineTo(x, y0 - Math.abs(Math.sin((x + off) / per)) * amp - Math.sin((x + off) / (per * 0.37)) * amp * 0.2);
  c.lineTo(W, H);
  c.fill();
}
function vignette(c, W, H, k = 0.55) {
  const g = c.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${k})`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

// ---------- pixel platformer (Mossy Leap, Frostbite Peaks) ----------
const PLAT = {
  moss: {
    sky: ['#8fd3ff', '#e9f7ff'],
    hill: ['#a8d88b', '#7fbf6a'],
    top: [1, 2, 3],
    fill: [4, 5, 24, 25],
    deco: [126, 124, 125, 128, 129],
    hero: [0, 1],
    cloud: '#ffffff',
  },
  frost: {
    sky: ['#1d2b53', '#5f7fb7'],
    hill: ['#a9c4e8', '#d5e6fb'],
    top: [81, 82, 83],
    fill: [4, 5, 24, 25],
    deco: [126, 145, 126, 144],
    hero: [2, 3],
    cloud: '#cfdcf0',
    snow: true,
  },
};
function platformer(theme, variant) {
  const th = PLAT[theme];
  return (c, t, W, H) => {
    const cam = t * 46 + variant * 400;
    sky(c, W, H, th.sky[0], th.sky[1]);
    if (th.snow) {
      c.fillStyle = '#f6f2d8';
      c.beginPath();
      c.arc(250, 38, 16, 0, 7);
      c.fill();
    }
    for (let i = 0; i < 5; i++) cloud(c, wrap(i * 90 - cam * 0.15, W + 80) - 40, 18 + (i % 3) * 14, 0.6, th.cloud);
    hills(c, W, H, cam * 0.25, th.hill[0], 120, 30, 60);
    hills(c, W, H, cam * 0.5 + 40, th.hill[1], 140, 22, 40);
    const tw = 18,
      col0 = Math.floor(cam / tw),
      groundY = 144;
    for (let k = -1; k < W / tw + 2; k++) {
      const col = col0 + k,
        x = col * tw - cam;
      const gap = variant === 1 && wrap(col, 14) > 10;
      if (gap) {
        T(c, 'pp', wrap(col, 2) ? 53 : 54, x, groundY + 4);
        T(c, 'pp', 73, x, groundY + 22);
        continue;
      }
      T(c, 'pp', th.top[1], x, groundY);
      T(c, 'pp', th.fill[col & 1], x, groundY + 18);
      T(c, 'pp', th.fill[2 + (col & 1)], x, groundY + 36);
      if (rnd(col) > 0.78) T(c, 'pp', th.deco[Math.floor(rnd(col * 3) * th.deco.length)], x, groundY - 18);
      if (wrap(col, 9) === 4) {
        [0, 1, 2].forEach((j) => T(c, 'pp', th.top[Math.min(j, 2)], x + j * tw, groundY - 54));
        T(c, 'pp', 10, x + tw, groundY - 108 + 36);
      }
      if (wrap(col, 6) === 2) {
        const sp = Math.floor(t * 6 + col) % 2;
        T(c, 'pp', 151 + sp, x, groundY - 80 + Math.sin(t * 3 + col) * 3);
      }
    }
    // hero: run with periodic jumps
    const ph = wrap(t, 1.6) / 1.6,
      jump = ph < 0.5 ? Math.sin(ph * 2 * Math.PI) * 44 : 0;
    T(c, 'ppc', th.hero[Math.floor(t * 8) % 2], 96, groundY - 24 - Math.max(0, jump));
    // flyer enemy
    const ex = wrap(260 - t * 30, W + 60) - 30;
    T(c, 'ppc', 24 + (Math.floor(t * 6) % 3), ex, 70 + Math.sin(t * 2.4) * 12);
    T(c, 'ppc', 18 + (Math.floor(t * 4) % 2), wrap(220 - t * 18 + variant * 90, W + 40) - 20, groundY - 24, {
      flip: true,
    });
    if (th.snow) {
      c.fillStyle = '#fff';
      for (let i = 0; i < 60; i++) {
        const x = wrap(rnd(i) * W - t * 12 + Math.sin(t + i) * 6, W),
          y = wrap(rnd(i + 9) * H + t * (14 + rnd(i) * 16), H);
        c.fillRect(x, y, 1 + (i % 2), 1 + (i % 2));
      }
    }
    // HUD
    for (let i = 0; i < 3; i++) T(c, 'pp', 44, 6 + i * 16, 4, { s: 0.8 });
    T(c, 'pp', 151, W - 50, 4, { s: 0.8 });
    c.fillStyle = '#fff';
    c.font = 'bold 10px monospace';
    c.fillText('x ' + (12 + Math.floor(t * 2)), W - 34, 15);
  };
}

// ---------- RestoreBound (tiny town) ----------
function restore(variant) {
  return (c, t, W, H) => {
    const cam = variant ? t * 10 : 0;
    for (let y = 0; y < H / 16 + 1; y++)
      for (let x = -1; x < W / 16 + 2; x++) {
        const wx = x + Math.floor(cam / 16);
        T(c, 'town', rnd(wx * 31 + y) > 0.85 ? (rnd(wx + y) > 0.5 ? 1 : 2) : 0, x * 16 - wrap(cam, 16), y * 16);
      }
    const ox = -cam;
    // path (9-slice)
    const P = [
      [12, 13, 14],
      [24, 25, 26],
      [36, 37, 38],
    ];
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 14; x++) T(c, 'town', P[y][x === 0 ? 0 : x === 13 ? 2 : 1], ox + 40 + x * 16, 100 + y * 16);
    const house = (hx, hy, roof, fixed) => {
      const r = fixed ? roof : [48, 49, 50];
      r.forEach((ti, i) => T(c, 'town', ti, hx + i * 16, hy));
      (fixed ? [64, 65, 66] : [60, 61, 62]).forEach((ti, i) => T(c, 'town', ti, hx + i * 16, hy + 16));
      [72, 74, 75].forEach((ti, i) => T(c, 'town', fixed ? ti : ti + 4, hx + i * 16, hy + 32));
    };
    const fixT = variant ? 99 : (t % 6) / 6;
    house(ox + 56, 44, [52, 53, 54], true);
    house(ox + 150, 44, [52, 53, 54], fixT > 0.55);
    if (!variant && fixT > 0.5 && fixT < 0.75)
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 6.28 + t * 2,
          r = 10 + (fixT - 0.5) * 120;
        c.fillStyle = i % 2 ? '#fabd2f' : '#fff';
        c.fillRect(ox + 174 + Math.cos(a) * r, 68 + Math.sin(a) * r * 0.6, 2, 2);
      }
    [44, 45, 45, 46].forEach((ti, i) => T(c, 'town', ti, ox + 220 + i * 16, 132));
    [
      [10, 20, 4],
      [20, 120, 16],
      [270, 30, 3],
      [290, 60, 15],
      [240, 20, 4],
      [8, 150, 27],
      [300, 140, 28],
      [380, 40, 4],
      [420, 120, 16],
    ].forEach(([x, y, i]) => T(c, 'town', i, ox + x, y));
    T(c, 'town', 105, ox + 200, 60);
    T(c, 'town', 94, ox + 120, 140);
    // villager walking with hammer swing
    const vx = variant ? 120 + Math.sin(t * 0.8) * 30 : 140 + (fixT < 0.5 ? fixT * 40 : 20);
    T(c, 'dun', 97, vx, 104 + Math.abs(Math.sin(t * 8)) * -2);
    if (!variant && fixT < 0.55) T(c, 'town', 115, vx + 10, 98, { rot: Math.sin(t * 14) * 0.6 });
    T(c, 'dun', 99, ox + 250 + Math.sin(t) * 6, 110);
    // quest banner
    c.fillStyle = 'rgba(40,40,40,.72)';
    c.fillRect(W - 126, 6, 120, 20);
    c.fillStyle = '#fabd2f';
    c.font = 'bold 8px monospace';
    c.fillText(variant ? 'Village restored 7/12' : 'Rebuild the bakery', W - 120, 19);
  };
}

// ---------- Crypt Crawlers / Lantern Hollow (tiny dungeon) ----------
function crypt(dark, variant) {
  return (c, t, W, H) => {
    c.fillStyle = '#1d1416';
    c.fillRect(0, 0, W, H);
    const cols = 20,
      rows = 11;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const edge = y === 0 || y === rows - 1 || x === 0 || x === cols - 1;
        if (edge) T(c, 'dun', y === 0 ? 40 : 57 + (x % 3), x * 16, y * 16);
        else T(c, 'dun', rnd(x * 7 + y) > 0.8 ? 49 + Math.floor(rnd(x + y * 3) * 4) : 48, x * 16, y * 16);
      }
    T(c, 'dun', 45, 9 * 16, 0);
    T(c, 'dun', 29, 4 * 16, 0);
    T(c, 'dun', 29, 15 * 16, 0);
    if (dark) {
      [
        [3, 3, 64],
        [6, 7, 65],
        [14, 3, 64],
        [16, 7, 65],
        [11, 5, 65],
      ].forEach(([x, y, i]) => T(c, 'dun', i, x * 16, y * 16));
    } else {
      [
        [2, 2, 63],
        [17, 2, 82],
        [17, 8, 75],
        [2, 8, 82],
      ].forEach(([x, y, i]) => T(c, 'dun', i, x * 16, y * 16));
    }
    const chestOpen = variant && wrap(t, 4) > 1.5;
    T(c, 'dun', chestOpen ? 91 : 89, 10 * 16, 2 * 16);
    if (chestOpen)
      for (let i = 0; i < 6; i++) {
        const k = wrap(t, 4) - 1.5;
        T(c, 'town', 93, 160 + Math.cos(i) * k * 18, 30 - k * 24 + k * k * 10 + i * 2, { s: 0.6 });
      }
    const heroes = dark ? [84] : [96, 97, 98, 99];
    heroes.forEach((h, i) => {
      const a = t * 0.7 + i * 1.6,
        x = 150 + Math.cos(a) * 60 - i * 6,
        y = 90 + Math.sin(a * 1.3) * 30;
      T(c, 'dun', h, x, y, { flip: Math.sin(a) > 0 });
      if (!dark && wrap(t * 1.3 + i, 2) < 0.25) {
        c.strokeStyle = '#fff';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(x + 8, y + 8, 12, -1 + i, 0.4 + i);
        c.stroke();
      }
    });
    const foes = dark ? [121, 122, 121] : [108, 109, 110, 120, 123];
    foes.forEach((f, i) => {
      const x = 40 + wrap(i * 70 + Math.sin(t + i) * 20 + t * (dark ? 8 : 0), 260),
        y = 40 + wrap(i * 37, 100) + Math.sin(t * 2 + i) * (dark ? 6 : 3);
      T(c, 'dun', f, x, y, { a: dark ? 0.55 + Math.sin(t * 3 + i) * 0.35 : 1 });
      if (!dark && wrap(t + i * 0.7, 2.5) < 0.5) {
        c.fillStyle = '#fb4934';
        c.font = 'bold 8px monospace';
        c.fillText('-' + (3 + i), x + 4, y - 4 - wrap(t + i * 0.7, 2.5) * 20);
      }
    });
    if (dark) {
      const lx = 150 + Math.cos(t * 0.7) * 60 + 8,
        ly = 90 + Math.sin(t * 0.91) * 30 + 8,
        flick = 70 + Math.sin(t * 13) * 3;
      const g = c.createRadialGradient(lx, ly, 6, lx, ly, flick);
      g.addColorStop(0, 'rgba(250,189,47,.08)');
      g.addColorStop(0.6, 'rgba(12,8,20,.7)');
      g.addColorStop(1, 'rgba(6,4,12,.96)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    } else vignette(c, W, H, 0.35);
    c.fillStyle = 'rgba(29,32,33,.75)';
    c.fillRect(4, H - 18, dark ? 92 : 120, 14);
    c.fillStyle = dark ? '#d3869b' : '#b8bb26';
    c.font = 'bold 8px monospace';
    c.fillText(dark ? 'Oil  ▮▮▮▯▯' : 'P1 ♥♥♥  P2 ♥♥  P3 ♥♥♥  P4 ♥', 8, H - 8);
  };
}

// ---------- Skyward Squadron (pixel shmup) ----------
function shmup(variant) {
  return (c, t, W, H) => {
    const sy = t * 30;
    for (let y = -1; y < H / 16 + 1; y++)
      for (let x = 0; x < W / 16; x++) T(c, 'shm', 42, x * 16, y * 16 + wrap(sy, 16));
    const isl = (ix, iy, w, h) => {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const tx = x === 0 ? 0 : x === w - 1 ? 2 : 1,
            ty = y === 0 ? 0 : y === h - 1 ? 2 : 1;
          T(c, 'shm', [37, 49, 61][ty] + tx, ix + x * 16, iy + y * 16);
        }
    };
    [
      [30, 0, 5, 4],
      [210, 120, 6, 5],
      [120, 260, 4, 3],
      [260, -160, 3, 3],
    ].forEach(([x, y, w, h], i) => {
      const yy = wrap(y + sy, H + 260) - 130;
      isl(x, yy, w, h);
      T(c, 'shm', 48, x + 18, yy + 18);
      T(c, 'shm', i % 2 ? 72 : 84, x + 34, yy + 26);
    });
    const px = W / 2 + Math.sin(t * 1.4) * 70;
    T(c, 'ships', 4, px - 16, H - 46);
    for (let i = 0; i < 6; i++) {
      const by = wrap(H - 50 - (t * 160 + i * 30), H);
      T(c, 'shm', 1, px - 8 + Math.sin(t * 1.4 - i * 0.2) * 4, by);
    }
    if (variant) {
      const bx = W / 2 + Math.sin(t * 0.6) * 60;
      T(c, 'ships', 12, bx - 32, 18 + Math.sin(t) * 4, { s: 2, flip: false });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.28 + t;
        T(c, 'shm', 18, bx - 6 + Math.cos(a) * wrap(t * 40, 120), 50 + Math.sin(a) * wrap(t * 40, 120), { s: 0.7 });
      }
      if (wrap(t, 1.2) < 0.3) T(c, 'shm', 5 + (Math.floor(t * 10) % 2), bx - 20 + Math.sin(t * 7) * 20, 40, { s: 1.6 });
    } else {
      for (let i = 0; i < 5; i++) {
        const k = wrap(t * 0.5 + i * 0.14, 1.4),
          ex = 40 + i * 56 + Math.sin(t * 2 + i) * 14,
          ey = -30 + k * 160;
        if (ey < H) T(c, 'ships', [5, 9, 13][i % 3], ex - 16, ey, { rot: Math.PI });
        if (k > 0.9 && k < 1.0) T(c, 'shm', 4 + (Math.floor(t * 12) % 3), ex - 8, ey + 8);
      }
    }
    c.fillStyle = '#282828';
    c.fillRect(0, 0, W, 13);
    c.fillStyle = '#fabd2f';
    c.font = 'bold 9px monospace';
    c.fillText('SCORE ' + String(4200 + Math.floor(t * 130)).padStart(6, '0'), 6, 10);
    c.fillText(variant ? 'BOSS' : 'WAVE 3', W - 46, 10);
  };
}

// ---------- Powder Rush (tiny ski) ----------
function ski(variant) {
  return (c, t, W, H) => {
    const sy = t * 70;
    for (let y = -1; y < H / 16 + 1; y++)
      for (let x = 0; x < W / 16; x++)
        T(c, 'ski', rnd(x * 13 + Math.floor((y * 16 + sy) / 16)) > 0.8 ? 1 : 0, x * 16, y * 16 - wrap(sy, 16));
    for (let i = 0; i < 14; i++) {
      const x = rnd(i) > 0.5 ? rnd(i * 3) * 70 : W - 20 - rnd(i * 5) * 70,
        y = wrap(rnd(i * 7) * 400 - sy, 400) - 30;
      T(c, 'ski', [6, 18, 30][i % 3], x, y);
    }
    for (let g = 0; g < 4; g++) {
      const y = wrap(g * 100 - sy, 400) - 30,
        x = 110 + Math.sin(g * 2.1) * 50;
      T(c, 'ski', 20, x, y);
      T(c, 'ski', 21, x + 56, y);
    }
    T(c, 'ski', 69, 70, wrap(240 - sy, 400) - 30);
    T(c, 'ski', 81, 220, wrap(330 - sy, 400) - 30);
    const sx = 160 + Math.sin(t * 2.2) * 56,
      lean = Math.cos(t * 2.2);
    for (let i = 1; i < 18; i++) {
      const tt = t - i * 0.03;
      c.fillStyle = 'rgba(131,165,152,.35)';
      c.fillRect(160 + Math.sin(tt * 2.2) * 56 + 5, 72 + i * 4, 6, 3);
    }
    T(c, 'ski', lean > 0 ? 70 : 71, sx, 60);
    for (let i = 0; i < 6; i++) {
      c.fillStyle = '#fff';
      c.fillRect(sx + 8 + Math.sin(t * 30 + i) * 8, 76 + wrap(t * 40 + i * 5, 14), 2, 2);
    }
    if (variant) {
      const yx = sx + Math.sin(t * 1.7) * 30;
      T(c, 'ski', 78 + (Math.floor(t * 5) % 3), yx, 8 + Math.sin(t * 3) * 3, { s: 1.4 });
    }
    c.fillStyle = 'rgba(40,40,40,.75)';
    c.fillRect(W - 78, 4, 74, 14);
    c.fillStyle = '#fff';
    c.font = 'bold 9px monospace';
    c.fillText(
      '0:' +
        String(41 + Math.floor(t)).padStart(2, '0') +
        '.' +
        (Math.floor(t * 10) % 10) +
        '  ' +
        (variant ? 'RUN!' : 'G' + (3 + (Math.floor(t / 2) % 5))),
      W - 74,
      14,
    );
  };
}

// ---------- Little Fronts (tiny battle) ----------
function battle(variant) {
  return (c, t, W, H) => {
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 20; x++) T(c, 'bat', rnd(x * 5 + y * 11) > 0.86 ? 1 : 0, x * 16, y * 16);
    const water = [
      [0, 6, 18],
      [1, 6, 19],
      [0, 7, 36],
      [1, 7, 37],
      [0, 8, 54],
      [1, 8, 55],
    ];
    water.forEach(([x, y, i]) => T(c, 'bat', i, x * 16, y * 16));
    for (let x = 2; x < 20; x++) T(c, 'bat', 110, x * 16, 9 * 16);
    [
      [3, 2, 26],
      [4, 2, 28],
      [15, 1, 62],
      [16, 2, 64],
      [9, 4, 94],
      [12, 6, 112],
      [6, 5, 112],
      [17, 6, 94],
    ].forEach(([x, y, i]) => T(c, 'bat', i, x * 16, y * 16));
    T(c, 'bat', 34, 2 * 16, 1 * 16);
    T(c, 'bat', 70, 17 * 16, 0);
    c.strokeStyle = 'rgba(40,40,40,.12)';
    c.lineWidth = 1;
    for (let x = 0; x <= W; x += 16) {
      c.beginPath();
      c.moveTo(x + 0.5, 0);
      c.lineTo(x + 0.5, H);
      c.stroke();
    }
    for (let y = 0; y <= H; y += 16) {
      c.beginPath();
      c.moveTo(0, y + 0.5);
      c.lineTo(W, y + 0.5);
      c.stroke();
    }
    const step = Math.floor(t * 1.5) % 6;
    const gx = 5 + Math.min(step, 4),
      gy = 4;
    if (!variant) {
      c.fillStyle = 'rgba(131,165,152,.35)';
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++)
          if (Math.abs(dx) + Math.abs(dy) <= 2) c.fillRect((5 + dx) * 16, (4 + dy) * 16, 16, 16);
    }
    T(c, 'bat', 115, gx * 16, gy * 16);
    T(c, 'bat', 61, gx * 16, gy * 16, { a: 0.5 + Math.sin(t * 6) * 0.4 });
    T(c, 'bat', 142, 4 * 16, 6 * 16);
    T(c, 'bat', 143, 5 * 16, 7 * 16);
    T(c, 'bat', 116, 3 * 16, 5 * 16);
    T(c, 'bat', 151, 13 * 16, 4 * 16, { flip: true });
    T(c, 'bat', 178, 14 * 16, 5 * 16, { flip: true });
    T(c, 'bat', 152, 15 * 16, 7 * 16, { flip: true });
    T(c, 'bat', 154, 12 * 16, 2 * 16, { flip: true });
    if (variant && wrap(t, 2) < 0.7) {
      const k = wrap(t, 2) / 0.7;
      c.fillStyle = '#fabd2f';
      c.fillRect(9 * 16 + k * 60, 4 * 16 + 8 - Math.sin(k * 3.14) * 20, 3, 3);
      if (k > 0.8) {
        c.fillStyle = 'rgba(254,128,25,.8)';
        c.beginPath();
        c.arc(13 * 16 + 8, 4 * 16 + 8, 10 + Math.random() * 4, 0, 7);
        c.fill();
      }
    }
    c.fillStyle = 'rgba(40,40,40,.8)';
    c.fillRect(4, 4, 104, 14);
    c.fillStyle = '#b8bb26';
    c.font = 'bold 9px monospace';
    c.fillText('GREEN · TURN ' + (4 + Math.floor(t / 4)), 8, 14);
  };
}

// ---------- Nebula Run (vector space) ----------
function space(variant) {
  return (c, t, W, H) => {
    const bg = IMG.sp_bg;
    const sy = wrap(t * 60, 256);
    if (bg.naturalWidth)
      for (let y = -1; y < H / 256 + 1; y++)
        for (let x = 0; x < W / 256 + 1; x++) c.drawImage(bg, x * 256, y * 256 + sy);
    for (let i = 0; i < 70; i++) {
      c.fillStyle = `rgba(255,255,255,${0.3 + rnd(i) * 0.7})`;
      c.fillRect(rnd(i * 3) * W, wrap(rnd(i * 5) * H + t * (40 + rnd(i) * 120), H), 2, 2);
    }
    S(c, 'sp_m1', wrap(120 + t * 20, W + 200) - 100, wrap(80 + t * 50, H + 200) - 100, { rot: t * 0.4, s: 0.9 });
    S(c, 'sp_m2', wrap(500 - t * 15, W + 200) - 100, wrap(240 + t * 70, H + 200) - 100, { rot: -t * 0.8 });
    const px = W / 2 + Math.sin(t * 1.3) * 160;
    for (let i = 0; i < 5; i++) S(c, 'sp_lb', px, wrap(H - 90 - t * 520 - i * 80, H), {});
    S(c, 'sp_ship', px, H - 60, { rot: Math.cos(t * 1.3) * 0.12 });
    c.fillStyle = 'rgba(131,165,152,.6)';
    c.beginPath();
    c.ellipse(px, H - 18, 8, 14 + Math.sin(t * 40) * 4, 0, 0, 7);
    c.fill();
    const foes = variant ? ['sp_e2', 'sp_e2', 'sp_e1'] : ['sp_e1', 'sp_e3', 'sp_e1', 'sp_e3', 'sp_e1'];
    foes.forEach((k, i) => {
      const ex = 80 + i * (480 / foes.length) + Math.sin(t * 1.5 + i) * 30,
        ey = 60 + Math.sin(t * 2 + i * 0.8) * 20 + (variant ? 20 : 0);
      S(c, k, ex, ey, { rot: Math.PI, s: variant ? 1.1 : 0.8 });
      if (wrap(t * 1.2 + i * 0.4, 2) < 0.1) S(c, 'sp_lr', ex, ey + 40);
      S(c, 'sp_lr', ex, wrap(ey + 40 + t * 260 + i * 70, H + 40));
    });
    if (wrap(t, 1.7) < 0.35) {
      const k = wrap(t, 1.7) / 0.35;
      c.fillStyle = `rgba(250,189,47,${1 - k})`;
      c.beginPath();
      c.arc(240, 70, 10 + k * 40, 0, 7);
      c.fill();
    }
    c.fillStyle = '#fff';
    c.font = 'bold 18px "Russo One", sans-serif';
    c.fillText(String(18200 + Math.floor(t * 310)), 16, 30);
    c.fillStyle = '#83a598';
    c.fillRect(W - 130, 14, 110 * (0.6 + Math.sin(t) * 0.1), 8);
    c.strokeStyle = '#fff';
    c.strokeRect(W - 130, 14, 110, 8);
  };
}

// ---------- Turbo Tumble (vector racing) ----------
function track(u) {
  // u 0..1 around a rounded-rect loop, returns [x, y, angle]
  const pts = [];
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    pts.push([320 + Math.cos(a) * 230 + Math.cos(a * 3) * 18, 180 + Math.sin(a) * 110]);
  }
  const k = wrap(u, 1) * pts.length,
    i0 = Math.floor(k),
    p = pts[i0],
    q = pts[(i0 + 1) % pts.length];
  return [p[0] + (q[0] - p[0]) * (k - i0), p[1] + (q[1] - p[1]) * (k - i0), Math.atan2(q[1] - p[1], q[0] - p[0])];
}
function racing(variant) {
  return (c, t, W, H) => {
    c.save();
    if (variant) {
      const [fx, fy] = track(t * 0.07);
      c.translate(W / 2, H / 2);
      c.scale(1.8, 1.8);
      c.translate(-fx, -fy);
    }
    c.fillStyle = '#79a85a';
    c.fillRect(-400, -400, W + 800, H + 800);
    for (let i = -10; i < 30; i++) {
      c.fillStyle = i % 2 ? '#86b464' : '#79a85a';
      c.fillRect(i * 40, -400, 20, H + 800);
    }
    const path = () => {
      c.beginPath();
      for (let i = 0; i <= 180; i++) {
        const [x, y] = track(i / 180);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
    };
    c.lineCap = c.lineJoin = 'round';
    path();
    c.strokeStyle = '#fbf1c7';
    c.lineWidth = 64;
    c.stroke();
    path();
    c.setLineDash([12, 12]);
    c.strokeStyle = '#cc241d';
    c.lineWidth = 64;
    c.stroke();
    c.setLineDash([]);
    path();
    c.strokeStyle = '#504945';
    c.lineWidth = 54;
    c.stroke();
    path();
    c.setLineDash([14, 16]);
    c.strokeStyle = '#ebdbb2';
    c.lineWidth = 2;
    c.stroke();
    c.setLineDash([]);
    S(c, 'trib', 320, 30, { s: 0.7 });
    S(c, 'trib', 180, 30, { s: 0.7 });
    [
      [320, 180],
      [40, 40],
      [600, 330],
      [600, 40],
      [40, 330],
      [260, 190],
      [380, 170],
    ].forEach(([x, y], i) => S(c, 'tree', x, y, { s: 0.5 + (i % 2) * 0.15 }));
    S(c, 'tires', 560, 120, { s: 0.5 });
    S(c, 'tires', 90, 250, { s: 0.5 });
    S(c, 'cone', 470, 100, { s: 0.5 });
    ['car_r', 'car_b', 'car_y', 'car_g'].forEach((k, i) => {
      const [x, y, a] = track(t * (0.07 - i * 0.004) - i * 0.025);
      S(c, k, x, y, { rot: a + Math.PI / 2, s: 0.32 });
    });
    c.restore();
    c.fillStyle = 'rgba(29,32,33,.8)';
    c.fillRect(12, 12, 120, 44);
    c.fillStyle = '#fabd2f';
    c.font = 'bold 22px "Russo One", sans-serif';
    c.fillText('P1', 20, 44);
    c.fillStyle = '#ebdbb2';
    c.font = 'bold 14px "Russo One", sans-serif';
    c.fillText('LAP ' + (1 + (Math.floor(t / 14) % 3)) + '/3', 60, 40);
  };
}

// ---------- Brick Bloom (vector puzzle) ----------
function bricks(variant) {
  return (c, t, W, H) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#32302f');
    g.addColorStop(1, variant ? '#4f3a4a' : '#3c3836');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(235,219,178,.06)';
    for (let x = 0; x < W; x += 24) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, H);
      c.stroke();
    }
    const keys = ['br_r', 'br_y', 'br_g', 'br_b', 'br_p'];
    const bx = W / 2 + Math.sin(t * 1.7) * 210,
      by = 210 + Math.abs(Math.sin(t * 2.3)) * -150;
    for (let r = 0; r < 5; r++)
      for (let k = 0; k < 8; k++) {
        const x = 92 + k * 66,
          y = 40 + r * 30,
          gone = variant ? rnd(r * 9 + k) < Math.min(0.85, t / 12) : rnd(r * 9 + k) < 0.15 + (t % 9) / 30;
        if (!gone) S(c, keys[(r + (variant ? k : 0)) % 5], x, y, { s: 0.9 });
      }
    for (let i = 0; i < 8; i++) {
      const k = wrap(t * 1.3 + i * 0.13, 1);
      S(c, 'star', 300 + Math.cos(i) * k * 70, 110 + Math.sin(i * 2) * k * 50, { s: 0.25 * (1 - k), a: 1 - k });
    }
    for (let i = 1; i < 8; i++) {
      const tt = t - i * 0.02;
      S(c, 'ball', W / 2 + Math.sin(tt * 1.7) * 210, 210 + Math.abs(Math.sin(tt * 2.3)) * -150, { s: 0.9, a: 0.12 });
    }
    S(c, 'ball', bx, by, { s: 0.9 });
    S(c, 'paddle', W / 2 + Math.sin(t * 1.7 - 0.2) * 200, 318, { s: 1.1 });
    if (variant) {
      c.fillStyle = '#fabd2f';
      c.font = 'bold 26px "Lilita One", sans-serif';
      c.fillText('COMBO x' + (2 + (Math.floor(t) % 6)), 24, 342);
    }
    c.fillStyle = '#ebdbb2';
    c.font = 'bold 16px "Lilita One", sans-serif';
    c.fillText('LEVEL ' + (variant ? 12 : 3), W - 100, 24);
  };
}

// ---------- Goblin Cellar (real prototype screenshots) ----------
function shot(key, zoom) {
  return (c, t, W, H) => {
    const im = IMG[key];
    c.fillStyle = '#2d2a3a';
    c.fillRect(0, 0, W, H);
    if (!im.naturalWidth) return;
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight) * (1.02 + (zoom ? t * 0.015 : 0.04 - t * 0.006));
    const w = im.naturalWidth * s,
      h = im.naturalHeight * s;
    c.drawImage(im, (W - w) / 2 + Math.sin(t * 0.3) * 8, (H - h) / 2, w, h);
  };
}

// Build-in-progress art for new games: a blueprint that fills in as the build progresses.
export function blueprint(c, t, W, H, p = 0) {
  c.fillStyle = '#076678';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(235,219,178,.18)';
  c.lineWidth = 1;
  for (let x = 0; x < W; x += 10) {
    c.beginPath();
    c.moveTo(x + 0.5, 0);
    c.lineTo(x + 0.5, H);
    c.stroke();
  }
  for (let y = 0; y < H; y += 10) {
    c.beginPath();
    c.moveTo(0, y + 0.5);
    c.lineTo(W, y + 0.5);
    c.stroke();
  }
  c.strokeStyle = 'rgba(251,241,199,.85)';
  c.lineWidth = 2;
  c.setLineDash([6, 5]);
  c.lineDashOffset = -t * 20;
  const isl = [
    [60, 110, 50],
    [160, 80, 46],
    [250, 115, 40],
  ];
  isl.forEach(([x, y, r], i) => {
    if (p > i * 0.25) {
      c.beginPath();
      c.ellipse(x, y, r, r * 0.35, 0, 0, 7);
      c.stroke();
    }
  });
  if (p > 0.6) {
    c.beginPath();
    c.moveTo(108, 105);
    c.quadraticCurveTo(130, 120, 116, 86);
    c.stroke();
    c.beginPath();
    c.moveTo(205, 86);
    c.quadraticCurveTo(230, 110, 212, 112);
    c.stroke();
  }
  c.setLineDash([]);
  if (p > 0.4) {
    c.fillStyle = 'rgba(250,189,47,.9)';
    c.beginPath();
    c.arc(270, 36, 12, 0, 7);
    c.fill();
  }
}

const PIX = [320, 180],
  VEC = [640, 360];
export const SCENES = {
  'goblin-cellar': {
    res: [480, 270],
    smooth: true,
    scenes: [shot('gc_fight', 1), shot('gc_edit', 0), shot('gc_play', 1), shot('gc_win', 0)],
    cover: [0, 2],
  },
  restorebound: { res: PIX, scenes: [restore(0), restore(1)], cover: [0, 3.2] },
  'mossy-leap': { res: PIX, scenes: [platformer('moss', 0), platformer('moss', 1)], cover: [0, 1.2] },
  'skyward-squadron': { res: PIX, scenes: [shmup(0), shmup(1)], cover: [0, 2.4] },
  'powder-rush': { res: PIX, scenes: [ski(0), ski(1)], cover: [1, 1.5] },
  'little-fronts': { res: PIX, scenes: [battle(0), battle(1)], cover: [0, 2] },
  'crypt-crawlers': { res: PIX, scenes: [crypt(false, 0), crypt(false, 1)], cover: [0, 1] },
  'nebula-run': { res: VEC, smooth: true, scenes: [space(0), space(1)], cover: [0, 3] },
  'turbo-tumble': { res: VEC, smooth: true, scenes: [racing(1), racing(0)], cover: [1, 4] },
  'brick-bloom': { res: VEC, smooth: true, scenes: [bricks(0), bricks(1)], cover: [0, 2.2] },
  'lantern-hollow': { res: PIX, scenes: [crypt(true, 0), crypt(true, 1)], cover: [0, 1.4] },
  'frostbite-peaks': { res: PIX, scenes: [platformer('frost', 0), platformer('frost', 1)], cover: [0, 1.1] },
};

// Draw one scene into a canvas sized to its box. Returns the logical size used.
export function paint(canvas, id, sceneIdx, t, extra) {
  const def = SCENES[id];
  const [W, H] = def.res;
  if (canvas.width !== W) {
    canvas.width = W;
    canvas.height = H;
  }
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = !!def.smooth;
  def.scenes[sceneIdx % def.scenes.length](c, t, W, H, extra);
}
