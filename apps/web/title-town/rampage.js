// The kaiju scene, after the arcade monster-rampage games: the Dino (Quaternius Ultimate Monsters, CC0) wades in from the
// bay, punches through the town wall, and wrecks the harbour quarter: punches, a stomp, a charge. Every blow breaks real
// pieces off the buildings (their own geometry, split at a jagged line), which fly, tumble, bounce and settle as rubble;
// anything his body would pass through breaks just before he reaches it, so nothing clips. Dust, flashes, grit, sparks,
// shock rings, cracks and fires come from fx.js. Then he wades back out and crews rebuild the wall and every house inside
// layered scaffolding. Everything is planned at setup and drawn from the loop time alone (capture mode is exact).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { FX, reseed } from './fx.js';
import { blocked, clearSegment, route, simplifyPath } from './crowd-path.js';

export const PER = 104;
const LEAVE = 58;   // when he is gone
const clamp01 = x => Math.min(1, Math.max(0, x)), smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const ease = x => 1 - (1 - clamp01(x)) ** 3, lerp = (a, b, k) => a + (b - a) * k;
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), rr = (a, b) => a + rnd() * (b - a);
const hashN = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

// ---------------- fracture ----------------
// split a non-indexed geometry (in building space, metres) into what stays and chunks of what breaks off; `breaks(cx, cy, cz)`
// decides per triangle by its centre; chunks are the broken triangles grouped by `cell`, each recentred on its own middle
export function fracture(geo, breaks, cell = 1.5) {
  const P = geo.attributes.position, N = geo.attributes.normal, UV = geo.attributes.uv, keep = { p: [], n: [], u: [] }, groups = new Map();
  for (let t = 0; t < P.count; t += 3) {
    const cx = (P.getX(t) + P.getX(t + 1) + P.getX(t + 2)) / 3, cy = (P.getY(t) + P.getY(t + 1) + P.getY(t + 2)) / 3, cz = (P.getZ(t) + P.getZ(t + 1) + P.getZ(t + 2)) / 3;
    let dst = keep;
    if (breaks(cx, cy, cz)) { const k = `${Math.floor(cx / cell)},${Math.floor(cy / cell)},${Math.floor(cz / cell)}`; if (!groups.has(k)) groups.set(k, { p: [], n: [], u: [] }); dst = groups.get(k); }
    for (let i = t; i < t + 3; i++) { dst.p.push(P.getX(i), P.getY(i), P.getZ(i)); dst.n.push(N.getX(i), N.getY(i), N.getZ(i)); if (UV) dst.u.push(UV.getX(i), UV.getY(i)); }
  }
  const mk = (d, c = [0, 0, 0]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(d.p.map((v, i) => v - c[i % 3]), 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(d.n, 3)); if (d.u.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(d.u, 2)); return g; };
  const chunks = [];
  for (const d of groups.values()) { const n = d.p.length / 3, c = [0, 0, 0]; for (let i = 0; i < d.p.length; i++) c[i % 3] += d.p[i] / n; let r = 0; for (let i = 0; i < d.p.length; i += 3) r = Math.max(r, Math.hypot(d.p[i] - c[0], d.p[i + 1] - c[1], d.p[i + 2] - c[2])); chunks.push({ geo: mk(d, c), c, r, tris: n / 3 }); }
  return { keep: mk(keep), chunks };
}

// split every triangle until no edge is longer than `max`, so a stretched model (the wall: a few faces over 14+ m) breaks
// into pieces of rubble instead of whole wall-length slivers
export function tessellate(geo, max = 1.2) {
  const P = geo.attributes.position, N = geo.attributes.normal, UV = geo.attributes.uv, out = { p: [], n: [], u: [] };
  const vert = i => ({ p: [P.getX(i), P.getY(i), P.getZ(i)], n: [N.getX(i), N.getY(i), N.getZ(i)], u: UV ? [UV.getX(i), UV.getY(i)] : null });
  const mid = (a, b) => ({ p: a.p.map((v, k) => (v + b.p[k]) / 2), n: a.n.map((v, k) => (v + b.n[k]) / 2), u: a.u && a.u.map((v, k) => (v + b.u[k]) / 2) });
  const len = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  const split = (a, b, c) => {
    const e = [len(a, b), len(b, c), len(c, a)], m = Math.max(...e);
    if (m <= max) { for (const v of [a, b, c]) { out.p.push(...v.p); out.n.push(...v.n); if (v.u) out.u.push(...v.u); } return; }
    if (m === e[0]) { const d = mid(a, b); split(a, d, c); split(d, b, c); }
    else if (m === e[1]) { const d = mid(b, c); split(a, b, d); split(a, d, c); }
    else { const d = mid(c, a); split(a, b, d); split(d, b, c); }
  };
  for (let i = 0; i < P.count; i += 3) split(vert(i), vert(i + 1), vert(i + 2));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(out.n, 3));
  if (out.u.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(out.u, 2)); return g;
}

// a chunk's flight, planned at 30 Hz: gravity, tumbling, bounces on the ground with friction, sinking in water
export function flight(p, v, w, r, ground, fx, t0, wall = null) {   // wall(x0, z0, x1, z1, y): the normal of a wall the step runs into, or null
  const frames = [], q = new THREE.Quaternion(), dq = new THREE.Quaternion(), axis = new THREE.Vector3(...w).normalize(), spin = Math.hypot(...w);
  let x = p[0], y = p[1], z = p[2], vx = v[0], vy = v[1], vz = v[2], s = spin, landed = false, wetted = false;
  for (let i = 0; i < 150; i++) {
    for (let k = 0; k < 2; k++) {   // two 1/60 s steps per frame
      const dt = 1 / 60; vy -= 24 * dt; const px = x, pz = z; x += vx * dt; y += vy * dt; z += vz * dt;
      const n = wall?.(px, pz, x, z, y); if (n) { x = px; z = pz; const vn = vx * n[0] + vz * n[1]; vx = (vx - 1.4 * vn * n[0]) * .6; vz = (vz - 1.4 * vn * n[1]) * .6; s *= .7; }   // the town wall holds it in
      const gy = ground(x, z), floor = gy < 0 ? -4 : gy + r * .35;
      if (gy < 0 && y < 0) { if (!wetted) { wetted = true; if (r > .6) fx.splash(t0 + i / 30, [x, z], .6); } vx *= .9; vz *= .9; vy = Math.max(vy, -3); s *= .95; }
      if (y < floor) { y = floor; if (gy >= 0) { if (!landed && r > .9 && vy < -6) fx.dust(t0 + i / 30, [x, y, z], .35); landed = true; vy = -vy * .28; vx *= .55; vz *= .55; s *= .55; if (Math.abs(vy) < 1.2) vy = 0; } else vy = 0; }
      dq.setFromAxisAngle(axis, s * dt); q.premultiply(dq);
    }
    frames.push(x, y, z, q.x, q.y, q.z, q.w);
    if (i > 20 && Math.abs(vx) + Math.abs(vy) + Math.abs(vz) < .2 && s < .2) break;
  }
  return new Float32Array(frames);
}

async function loadMonster(name, height) {
  const g = await new GLTFLoader().loadAsync(`models/monsters/${name}.glb`), root = g.scene;
  root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; const m = o.material; if (m) { m.metalness = 0; m.roughness = 1; m.color?.lerp(new THREE.Color('#fbf1c7'), .1); } } });
  const box = new THREE.Box3().setFromObject(root), s = height / (box.max.y - box.min.y), holder = new THREE.Group();
  root.scale.setScalar(s); root.position.y = -box.min.y * s; holder.add(root);
  const mixer = new THREE.AnimationMixer(root), actions = {};
  for (const clip of g.animations) actions[clip.name.split('|').pop()] = mixer.clipAction(clip);
  return { g: holder, mixer, actions };
}

// ctx: { scene, camera, U, PLAIN, ground(x, z), kenney(path), kitMat(map, o), houses: [{x, z, rot, s, model, roof, h}],
//        wall: { x, z, yaw, L, KW }, breach: [x, z], inward: [x, z], scaffold(w, d, h, n), layers(sc, n), stepped(k, h), steps(h) }
export async function kaiju(ctx) {
  const { scene, PLAIN, ground } = ctx; seed = 7; reseed(11);
  const fx = new FX(scene, ctx.camera, ctx.U);
  const H = 17, BODY = 3.6;   // the Dino's height and body radius
  const M = await loadMonster('dino', H); scene.add(M.g);
  const [bx, bz] = ctx.breach, [nx, nz] = ctx.inward, [sx, sz] = [nz, -nx];
  const P = (a, b) => [bx + nx * a + sx * b, bz + nz * a + sz * b];   // a: metres inward from the wall, b: metres to the side
  // ---- destructibles: the zone's houses and the wall section, each a mesh we can break step by step
  const D = [];
  const addThing = (geo, map, tint, x, z, rot, scale, h, kind) => {
    let g = geo.clone(); if (g.index) g = g.toNonIndexed(); g.scale(...scale); g.rotateY(rot); if (kind === 'wall') g = tessellate(g);
    const mat = ctx.kitMat(map, { tint: new THREE.Color(tint) }), chunkMat = mat.clone(); chunkMat.side = THREE.DoubleSide;
    chunkMat.uniforms = { ...mat.uniforms, cut: { value: 9999 } };   // share the live day/night uniforms; clone() copies them frozen
    const whole = new THREE.Mesh(g, mat); whole.position.set(x, PLAIN, z); scene.add(whole);
    const d = { kind, x, z, h, yaw: rot, L: kind === 'wall' ? scale[0] : 0, r: kind === 'wall' ? 0 : Math.max(scale[0], scale[2]) * .7, geo: g, mat, chunkMat, whole, versions: [{ t: -1, mesh: whole }], chunks: [], hits: [], rebuild: 0, burns: false };
    D.push(d); return d;
  };
  for (const h of ctx.houses) { const k = await ctx.kenney(h.model); addThing(k.geo, k.map, h.roof, h.x, h.z, h.rot, [h.s, h.s, h.s], k.h * h.s, 'house'); }
  const wk = await ctx.kenney('castle/wall'), W = ctx.wall;
  // the town wall keeps a house's debris inside (except through the breach): a step that crosses a wall piece below its top bounces back
  const WTOP = PLAIN + wk.h * W.KW, WSEG = (ctx.walls || []).map(w => ({ x: w.x, z: w.z, L: w.L, ax: Math.cos(w.yaw), az: -Math.sin(w.yaw), nx: Math.sin(w.yaw), nz: Math.cos(w.yaw) }));
  const wallStop = (x0, z0, x1, z1, y) => { if (y > WTOP) return null;
    for (const w of WSEG) { const p0 = (x0 - w.x) * w.nx + (z0 - w.z) * w.nz, p1 = (x1 - w.x) * w.nx + (z1 - w.z) * w.nz, h = W.KW * .5;
      if (Math.abs(p1) > h || Math.abs(p0) <= Math.abs(p1)) continue;
      const a = (x1 - w.x) * w.ax + (z1 - w.z) * w.az; if (Math.abs(a) > w.L / 2) continue;
      if (Math.hypot(x1 - bx, z1 - bz) < 6) continue;
      const sg = Math.sign(p0) || 1; return [w.nx * sg, w.nz * sg]; }
    return null; };
  const wall = addThing(wk.geo, wk.map, '#7d8fb8', W.x, W.z, W.yaw, [W.L, W.KW, W.KW], wk.h * W.KW, 'wall');
  // break part of a thing at time t: `top` is the new height (jagged), `side` limits the break to one face (a punch's corner),
  // `dir` is where the pieces fly, `power` how hard
  const SHAKES = [];
  let TAG = null;   // the attack whose consequences are being planned (the player can prevent it: see `tap` below)
  function hit(d, t, { top = 0, dir = [nx, nz], power = 1, side = null, at = null, span = null }) {
    const cur = d.versions[d.versions.length - 1].geoCur || d.geo, storey = 3.1;
    const breaks = (cx, cy, cz) => {
      if (span) { const along = cx * Math.cos(d.yaw) - cz * Math.sin(d.yaw); return Math.abs(along - span[0]) < span[1] + (hashN(cy, along) - .5) * 1.6; }
      const jag = top + (hashN(Math.round(cx * 1.3), Math.round(cz * 1.3)) - .5) * storey * .9;
      if (cy <= jag) return false;
      if (side) { const pr = cx * side[0] + cz * side[1]; return pr > -.6 + (hashN(cy, pr) - .5); }
      return true;
    };
    const { keep, chunks } = fracture(cur, breaks);
    if (!chunks.length) return;
    const mesh = new THREE.Mesh(keep, d.mat); mesh.position.set(d.x, PLAIN, d.z); mesh.visible = false; scene.add(mesh);
    d.versions.push({ t, mesh, geoCur: keep, tag: TAG });
    const hitAt = at || [d.x, PLAIN + top + 2, d.z];
    for (const c of chunks) {
      if (c.tris < 2) continue;
      // a solid core in the piece's own colour, so it reads as a lump of building rather than a shell
      const sz = Math.min(1.7, c.r * 1.1), core = new THREE.BoxGeometry(sz, sz * .8, sz).toNonIndexed(), uv = c.geo.attributes.uv;
      if (uv) { const u = uv.getX(0), w = uv.getY(0), a = new Float32Array(core.attributes.position.count * 2); for (let k = 0; k < a.length; k += 2) { a[k] = u; a[k + 1] = w; } core.setAttribute('uv', new THREE.BufferAttribute(a, 2)); }
      const m = new THREE.Mesh(uv ? mergeGeometries([c.geo, core]) : c.geo, d.chunkMat); m.visible = false; scene.add(m);
      const p = [d.x + c.c[0], PLAIN + c.c[1], d.z + c.c[2]], out = [p[0] - hitAt[0], p[2] - hitAt[2]], ol = Math.hypot(...out) || 1;
      const sp = rr(3, 9) * power, v = [dir[0] * sp * .8 + out[0] / ol * sp * .5 + rr(-2, 2), rr(2, 8) * Math.sqrt(power), dir[1] * sp * .8 + out[1] / ol * sp * .5 + rr(-2, 2)];
      d.chunks.push({ m, tag: TAG, t0: t + rr(0, .06), frames: flight(p, v, [rr(-1, 1), rr(-1, 1), rr(-1, 1)].map(x => x * rr(2, 9)), c.r, ground, fx, t, d.kind === 'house' ? wallStop : null) });
    }
    d.hits.push(t); (d.hitTags ||= []).push(TAG); d.brokenTo = top; if (span && d.spanAt === undefined) d.spanAt = span[0];
    fx.dust(t + .05, [d.x, PLAIN + Math.max(1, top), d.z], d.kind === 'wall' ? 1.2 : .8 + power * .3);
    fx.debris(t, hitAt, dir, .8 + power * .3); fx.flash(t, hitAt, .6 + power * .3);
    SHAKES.push({ t, a: .25 * power, tag: TAG });
  }

  // a punch or a swipe: the house he hits is torn off its footing and thrown into the next one along, and both come down.
  // Every blow differs: how much of it goes, how hard, which neighbour it lands on, how long the throw takes
  const IMPACT_SND = [];
  function blow(s, tc) {
    const d = s.target, pd = [Math.sin(s.yaw), Math.cos(s.yaw)], swipe = s.clip === 'Weapon';
    const nb = D.filter(o => o !== d && o.kind === 'house' && !gone(o, tc)).map(o => { const v = [o.x - d.x, o.z - d.z], l = Math.hypot(...v) || 1; return { o, l, dot: (v[0] * pd[0] + v[1] * pd[1]) / l }; })
      .filter(c => c.l < 15 && c.dot > (swipe ? -.2 : .25)).sort((a, b) => (a.l - a.dot * 6) - (b.l - b.dot * 6));
    const into = nb[0]?.o, dir = into ? (() => { const v = [into.x - d.x, into.z - d.z], l = Math.hypot(...v); return [lerp(pd[0], v[0] / l, .7), lerp(pd[1], v[1] / l, .7)]; })() : pd;
    const pw = rr(1.5, 2.1), at = [d.x - pd[0] * d.r, PLAIN + d.h * rr(.45, .7), d.z - pd[1] * d.r];
    hit(d, tc, { top: d.h * rr(.04, .2), dir, power: pw, at }); fx.dust(tc + .05, [d.x, PLAIN + 2, d.z], rr(1.2, 1.6)); fx.ring(tc, [d.x, PLAIN, d.z], rr(.6, .9));
    SHAKES.push({ t: tc, a: .5, tag: TAG }); IMPACT_SND.push({ t: tc, tag: TAG, big: true });
    if (into) {   // the throw: a stream of grit along the way, then the second house caves in where it lands
      const l = Math.hypot(into.x - d.x, into.z - d.z), ti = tc + .18 + l / rr(16, 24);
      for (let k = 1; k <= 3; k++) { const u = k / 4; fx.debris(tc + (ti - tc) * u, [lerp(d.x, into.x, u), PLAIN + d.h * .5 * (1 - u) + 2, lerp(d.z, into.z, u)], dir, .8); }
      hit(into, ti, { top: into.h * rr(.1, .35), dir, power: rr(1.1, 1.5), at: [into.x - dir[0] * into.r, PLAIN + into.h * .5, into.z - dir[1] * into.r] });
      fx.dust(ti + .05, [into.x, PLAIN + 2, into.z], rr(1.2, 1.7)); fx.flash(ti, [into.x, PLAIN + into.h * .5, into.z], 1.2);
      SHAKES.push({ t: ti, a: .4, tag: TAG }); IMPACT_SND.push({ t: ti, tag: TAG, big: true });
      if (swipe) { const o2 = nb[1]?.o; if (o2) hit(o2, ti + rr(.1, .25), { top: o2.h * rr(.3, .6), dir, power: 1 }); }   // the swipe carries on into a third
    }
    for (const o of D) if (o !== d && o !== into && o.kind === 'house' && Math.hypot(o.x - d.x, o.z - d.z) < 5.5) hit(o, tc + rr(.08, .2), { top: o.h * rr(.55, .8), dir, power: .7 });   // and knocks the corner off whatever is close
  }

  // ---- the choreography: where he is and what he does, second by second
  const [sea, ford] = ctx.approach || [P(-75, 6), P(-40, 3)];   // he wades in from the sea (across the river mouth in the menu)
  const pts = { sea, ford, outside: P(-6, 0), gap: P(9, 0), a: P(16, 7), b: P(24, -5), c: P(26, -14), back: P(-6, -2), away: P(-80, -10) };
  const C = ctx.castle, cf = [Math.sin(C.face), Math.cos(C.face)], cs = [cf[1], -cf[0]];
  const fieldFrom = P(-35, 70), fieldTo = P(-15, 24);   // the field trebuchet: pushed in from far down the fields, turned, and pushed away again after
  // when a swing connects: the moment the forearm is furthest forward in the clip (so debris and flashes land on the blow)
  const contact = {};
  for (const name of ['Punch', 'Weapon']) {
    const a = M.actions[name]; if (!a) continue; const d = a.getClip().duration; let best = -1e9, bt = d * .5;
    const arms = []; M.g.traverse(o => { if (/LowerArm/.test(o.name)) arms.push(o); });
    M.mixer.stopAllAction(); a.play();
    for (let i = 0; i <= 40; i++) { a.time = d * i / 40; M.mixer.update(0); M.g.updateMatrixWorld(true);
      for (const o of arms) { const z = o.getWorldPosition(new THREE.Vector3()).z; if (z > best) { best = z; bt = a.time; } } }
    contact[name] = bt; M.mixer.stopAllAction();
  }
  const S = [];   // segments: move between points, act on the spot, get knocked back, turn
  const seg = (t0, t1, kind, from, to, clip, face, o = {}) => S.push({ t0, t1, kind, from, to, clip, face, ...o });
  let cur = pts.sea, T = 0;
  const go = (t1, to, clip = 'Walk') => { seg(T, t1, 'move', cur, to, clip); cur = to; T = t1; };
  const act = (t1, clip, o = {}) => { seg(T, t1, 'act', cur, cur, clip, o.face || null, o); T = t1; };   // clips play once (rate slows them to his size)
  const knock = (t1, src, dist, rate = .7) => { const dx = cur[0] - src[0], dz = cur[1] - src[1], L = Math.hypot(dx, dz) || 1, to = [cur[0] + dx / L * dist, cur[1] + dz / L * dist];
    seg(T, t1, 'knock', cur, to, 'HitReact', null, { rate, yaw: Math.atan2(-dx, -dz) }); cur = to; T = t1; };   // reels back, still facing the blow
  const turn = (t1, toward) => { seg(T, t1, 'turn', cur, cur, 'Idle', null, { toward }); T = t1; };
  const stumble = (t1, dist, toward) => { const f = Math.atan2(toward[0] - cur[0], toward[1] - cur[1]), to = [cur[0] + Math.sin(f) * dist, cur[1] + Math.cos(f) * dist];   // pitched forward, the way he was turning
    seg(T, t1, 'knock', cur, to, 'HitReact', null, { rate: .6, yaw: f }); cur = to; T = t1; };
  const castleSrc = [C.x, C.z];
  go(5, pts.ford); go(10, pts.outside);
  act(11.8, 'Punch', { face: [nx, nz], rate: .6 });           // through the wall
  go(14.6, pts.gap);
  act(16, 'Weapon', { rate: .6 });                           // a sweeping swipe at a house on the left
  go(18.4, pts.a);
  act(19.9, 'Punch', { rate: .65 });                         // a house on the right
  go(21.4, pts.b, 'Run');                                    // charge
  act(22.4, 'Jump', { rate: .35 }); act(23.4, 'Jump_Land', { rate: .33 });   // stomp
  act(25, 'Yes');                                            // roar (the first boulder lands beside him at 25.4)
  act(26.4, 'Punch', { rate: .6 });
  go(29.6, pts.c);                                           // a ballista bolt stings him on the way (27.6, a flinch)
  act(31, 'Weapon', { rate: .6 });
  knock(31.8, castleSrc, 3.5);                               // castle trebuchet boulder, 31.0
  act(33.4, 'Yes');                                          // furious
  act(34.8, 'Punch', { rate: .6 });                          // still wrecking
  knock(35.8, castleSrc, 3.5);                               // second castle boulder, 35.0 (a bolt at 36.5 makes him flinch)
  act(37.6, 'No', { rate: 1.2 });                            // the field boulder misses (37.6)
  turn(38.7, pts.ford);                                      // he turns to go, away from us, toward the sea
  stumble(39.9, 4.5, pts.ford);                              // a castle boulder hits his back (38.8): he stumbles forward
  go(43.6, pts.ford, 'Run'); go(LEAVE, pts.sea, 'Run');      // and flees out through the coastal wall, back into the sea
  const posAt = t => {   // position and heading at time t
    const s = S.find(s => t >= s.t0 && t < s.t1) || S[S.length - 1], k = clamp01((t - s.t0) / (s.t1 - s.t0));
    const kk = s.kind === 'knock' ? ease(k) : s.lunge ? smooth(clamp01((t - s.t0) / (s.lungeT || .5))) : k, x = lerp(s.from[0], s.to[0], kk), z = lerp(s.from[1], s.to[1], kk);   // a blow at a house out of reach starts with a step in
    let yaw = rawYaw(s, k); const i = S.indexOf(s);
    if (i > 0 && s.kind !== 'turn') { const y0 = rawYaw(S[i - 1], 1), d = wrapA(yaw - y0);   // every change of heading is turned through, never snapped
      if (Math.abs(d) > .02) yaw = y0 + d * smooth(clamp01((t - s.t0) / Math.min(s.kind === 'knock' ? .3 : .3 + Math.abs(d) * .35, (s.t1 - s.t0) * .6))); }
    return { s, k, x, z, yaw };
  };
  const wrapA = d => Math.atan2(Math.sin(d), Math.cos(d));
  const rawYaw = (s, k) => s.kind === 'move' ? Math.atan2(s.to[0] - s.from[0], s.to[1] - s.from[1]) : s.kind === 'turn' && s.yaw1 !== undefined ? s.yaw0 + wrapA(s.yaw1 - s.yaw0) * smooth(k) : s.yaw ?? 0;
  // ---- whatever stands on his route: the wall pieces, towers and houses near it become breakable too, so he never walks
  // through anything (city.js claimNear takes them out of the town's meshes)
  { const route = []; for (let t = 0; t < LEAVE; t += .5) { const q = posAt(t); route.push([q.x, q.z]); }
    const got = ctx.claimNear(route, BODY + 4, [W.entry]);
    for (const w of got.walls) addThing(wk.geo, wk.map, '#7d8fb8', w.x, w.z, w.yaw, [w.L, W.KW, W.KW], wk.h * W.KW, 'wall');
    for (const tw of got.towers) { const geos = [], base = await ctx.kenney(tw.parts[0].model);
      for (const pt of tw.parts) { const k = await ctx.kenney(pt.model), g = k.geo.clone(); g.scale(pt.s, pt.s, pt.s); g.rotateY(pt.rot); g.translate(0, pt.y - PLAIN, 0); geos.push(g.index ? g.toNonIndexed() : g); }
      const g = mergeGeometries(geos); g.computeBoundingBox(); addThing(g, base.map, '#7d8fb8', tw.x, tw.z, 0, [1, 1, 1], g.boundingBox.max.y, 'tower').r = tw.parts[0].s * .6; }
    for (const h of got.houses) { const k = await ctx.kenney(h.model); addThing(k.geo, k.map, h.roof, h.x, h.z, h.rot, [h.s, h.s, h.s], k.h * h.s, 'house'); } }
  const standing = d => d.kind === 'house' || d.kind === 'tower';
  // shoves first (they follow from his route alone): anything his body would touch breaks just before contact
  const shoves = [];
  for (let t = 0; t < LEAVE; t += .1) {
    const p = posAt(t);
    for (const d of D) {
      if (standing(d)) { if (!d.shoved && Math.hypot(d.x - p.x, d.z - p.z) < BODY + d.r + .5) { d.shoved = t; shoves.push({ d, t }); } continue; }
      const ux = Math.cos(d.yaw), uz = -Math.sin(d.yaw), a = (p.x - d.x) * ux + (p.z - d.z) * uz, perp = Math.abs((p.x - d.x) * -uz + (p.z - d.z) * ux);
      if (Math.abs(a) < d.L / 2 + 1 && perp < BODY + W.KW * .5 + .6 && !(d.spans ||= []).some(s => Math.abs(s - a) < 5)) { d.spans.push(a); shoves.push({ d, t, a }); }
    }
  }
  const stompS = S.find(s => s.clip === 'Jump_Land'), stompT = stompS ? stompS.t0 + .1 : 1e9;
  const gone = (d, t) => (d.shoved !== undefined && d.shoved < t) || (stompS && t > stompT && Math.hypot(d.x - stompS.from[0], d.z - stompS.from[1]) < 6.5);
  // facings for blows: the nearest house still standing at that moment, in reach; a sweeping swipe and a punch never pick the same one
  const punched = [];
  for (const s of S) {
    if (s.kind === 'move' || s.kind === 'knock') continue;
    const prev = S[S.indexOf(s) - 1], fallbackYaw = prev ? (prev.kind === 'move' ? Math.atan2(prev.to[0] - prev.from[0], prev.to[1] - prev.from[1]) : prev.yaw) : 0;
    if (s.face) s.yaw = Math.atan2(s.face[0], s.face[1]);
    else if (s.kind === 'turn') { s.yaw0 = fallbackYaw; s.yaw1 = s.yaw = Math.atan2(s.toward[0] - s.from[0], s.toward[1] - s.from[1]); }
    else if (s.clip === 'Punch' || s.clip === 'Weapon') { const tc = s.t0 + (contact[s.clip] ?? .5) / (s.rate || 1);
      const c = D.filter(d => d.kind === 'house' && !punched.includes(d) && !gone(d, tc)).sort((a, b) => Math.hypot(a.x - s.from[0], a.z - s.from[1]) - a.r - (Math.hypot(b.x - s.from[0], b.z - s.from[1]) - b.r))[0];
      if (c) { punched.push(c); s.target = c; s.yaw = Math.atan2(c.x - s.from[0], c.z - s.from[1]); } else s.yaw = fallbackYaw; }
    else s.yaw = fallbackYaw;
  }
  // out of reach? he steps in as he swings (and everything after starts from where he ends up)
  for (const s of S) { if (!s.target) continue; const d = s.target, v = [d.x - s.from[0], d.z - s.from[1]], l = Math.hypot(...v), reach = BODY + d.r + 2.2;
    if (l <= reach) continue; const old = s.from, to = [old[0] + v[0] / l * (l - reach), old[1] + v[1] / l * (l - reach)], dl = [to[0] - old[0], to[1] - old[1]];
    s.to = to; s.lunge = true; s.lungeT = Math.min(.6, (contact[s.clip] ?? .5) / (s.rate || 1) * .8);
    for (let i = S.indexOf(s) + 1; i < S.length; i++) { const n = S[i]; if (n.from[0] !== old[0] || n.from[1] !== old[1]) break;
      n.from = to; if (n.kind !== 'move') n.to = [n.to[0] + dl[0], n.to[1] + dl[1]]; if (n.kind === 'move') break; } }
  for (let t = 0; t < LEAVE; t += .1) { const p = posAt(t);   // the steps in can touch more
    for (const d of D) if (standing(d) && !d.shoved && !S.some(s => s.target === d) && Math.hypot(d.x - p.x, d.z - p.z) < BODY + d.r + .5) { d.shoved = t; shoves.push({ d, t }); } }
  // ---- impacts, in time order (so each break works on what the last one left)
  const events = [], ATK = [];   // ATK: the blows the player can stop by hitting him first: { tag, from, tc, segs }
  for (const s of S) {
    const tc = s.t0 + (contact[s.clip] ?? .5) / (s.rate || 1);   // the blow lands on the clip's contact frame
    if (s.target) ATK.push({ tag: 'a' + ATK.length, from: s.t0 - .6, tc, segs: [s] });
    if (s.clip === 'Jump_Land') { const j = S[S.indexOf(s) - 1]; ATK.push({ tag: 'a' + ATK.length, from: j.t0 - .6, tc: s.t0 + .1, segs: [j, s] }); }
    const tag = ATK.find(a => a.segs.includes(s))?.tag ?? null;   // the wall punch always lands: his way in depends on it
    if (s.clip === 'Punch' && s.face) events.push({ t: tc, f: () => { hit(wall, tc, { span: [0, 5.5], dir: [nx, nz], power: 2.1, at: [W.x, PLAIN + 3, W.z] }); fx.ring(tc, [W.x, PLAIN, W.z], 1.1);
      fx.dust(tc + .05, [W.x, PLAIN + 2, W.z], 1.7); fx.flash(tc, [W.x, PLAIN + 3, W.z], 1.3); SHAKES.push({ t: tc, a: .6, tag: null }); IMPACT_SND.push({ t: tc, tag: null, big: true });
      const into = D.filter(o => o.kind === 'house' && !gone(o, tc)).map(o => { const v = [o.x - W.x, o.z - W.z], l = Math.hypot(...v) || 1; return { o, l, dot: (v[0] * nx + v[1] * nz) / l }; })
        .filter(c => c.l < 16 && c.dot > .3).sort((a, b) => (a.l - a.dot * 6) - (b.l - b.dot * 6))[0]?.o;
      if (into) { const l = Math.hypot(into.x - W.x, into.z - W.z), ti = tc + .18 + l / 20, dir = [nx, nz];   /* the wall's stones are hurled into the first house inside */
        for (let k = 1; k <= 3; k++) { const u = k / 4; fx.debris(tc + (ti - tc) * u, [lerp(W.x, into.x, u), PLAIN + 3 * (1 - u) + 2, lerp(W.z, into.z, u)], dir, .9); }
        hit(into, ti, { top: into.h * rr(.1, .3), dir, power: 1.5, at: [into.x - dir[0] * into.r, PLAIN + into.h * .5, into.z - dir[1] * into.r] });
        fx.dust(ti + .05, [into.x, PLAIN + 2, into.z], 1.5); fx.flash(ti, [into.x, PLAIN + into.h * .5, into.z], 1.1); SHAKES.push({ t: ti, a: .4, tag: null }); IMPACT_SND.push({ t: ti, tag: null, big: true }); } } });
    else if (s.target) events.push({ t: tc, tag, f: () => blow(s, tc) });
    else if (s.clip === 'Jump_Land') events.push({ t: s.t0 + .1, tag, f: () => { const [x, z] = s.from, t = s.t0 + .1;
      fx.ring(t, [x, PLAIN, z], 1.6); fx.decal(t, 60, 'crack', [x, PLAIN, z], 14); fx.dust(t, [x, PLAIN, z], 1.6); SHAKES.push({ t, a: .7, tag });
      for (const o of D) { if (o.kind !== 'house') continue; const dd = Math.hypot(o.x - x, o.z - z); if (dd > 14) continue;
        const away = [(o.x - x) / (dd || 1), (o.z - z) / (dd || 1)];
        hit(o, t + dd * .02, { top: dd < 6.5 ? o.h * .12 : o.h * lerp(.5, .8, (dd - 6.5) / 7.5), dir: away, power: dd < 6.5 ? 1.5 : .8 }); } } });
  }
  for (const { d, t, a } of shoves) { const t0 = Math.max(0, t - .25), q = posAt(t), dir = [Math.sin(q.yaw), Math.cos(q.yaw)];
    events.push({ t: t0, f: () => { if (a === undefined) hit(d, t0, { top: d.h * .08, dir, power: 1.1 });
      else { hit(d, t0, { span: [a, 4.5], dir, power: 1.3, at: [d.x + Math.cos(d.yaw) * a, PLAIN + 3, d.z - Math.sin(d.yaw) * a] }); fx.ring(t0, [d.x + Math.cos(d.yaw) * a, PLAIN, d.z - Math.sin(d.yaw) * a], .7); }
      if (d.kind !== 'house') IMPACT_SND.push({ t: t0, tag: null, big: true }); } });
  }
  events.sort((a, b) => a.t - b.t).forEach(e => { TAG = fx.tag = e.tag ?? null; e.f(); TAG = fx.tag = null; });
  // ---- the castle fights back: two trebuchets on the castle hill and a ballista on the near wall (Kenney Castle Kit)
  const engines = [];
  const engine = async (model, x, z, y, s) => {   // kept as a node tree so the trebuchet's arm can swing and the ballista's bolt can fly
    const k = await ctx.kenneyScene(model), o = k.scene; o.scale.setScalar(s); o.position.set(x, y, z); scene.add(o);
    const e = { o, x, z, y, s, arm: o.getObjectByName('arm'), arrow: o.getObjectByName('arrow'), shots: [] }; engines.push(e);
    if (e.arm) { o.traverse(n => { if (/^(catapult|weight)/.test(n.name) && n.parent !== e.arm) n.visible = false; });   // the kit also has a loose copy of the sling and weight that wouldn't swing
      const sling = e.arm.children.find(n => /^catapult/.test(n.name));   // a boulder sits in the sling until it's thrown (rolled up loaded)
      if (sling) { e.loaded = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 / s, 0), new THREE.MeshLambertMaterial({ color: '#8d8682', flatShading: true })); e.loaded.position.set(0, -.3, 0); sling.add(e.loaded); } }
    return e;
  };
  const tre1 = await engine('castle/siege-trebuchet', C.x + cf[0] * (C.r + 6) + cs[0] * 9, C.z + cf[1] * (C.r + 6) + cs[1] * 9, ground(C.x + cf[0] * (C.r + 6), C.z + cf[1] * (C.r + 6)), 4.5);
  const tre2 = await engine('castle/siege-trebuchet', C.x + cf[0] * (C.r + 6) - cs[0] * 9, C.z + cf[1] * (C.r + 6) - cs[1] * 9, ground(C.x + cf[0] * (C.r + 6), C.z + cf[1] * (C.r + 6)), 4.5);
  const bal = await engine('castle/siege-ballista', ...P(8, 22), PLAIN, 3.6);
  const field = await engine('castle/siege-trebuchet', ...fieldTo, ground(...fieldTo), 4.2);
  // the trebuchet's arm lies along its +x (sling at -x, thrown over the top toward +x) and it rolls along x: aim and push it along x
  const alongX = (dx, dz) => Math.atan2(-dz, dx);
  for (const e of engines) e.o.rotation.y = e.arm ? alongX(pts.c[0] - e.x, pts.c[1] - e.z) : Math.atan2(pts.c[0] - e.x, pts.c[1] - e.z) + Math.PI;
  field.move = { t0: 1, t1: 31, back0: LEAVE + 2, back1: LEAVE + 30, from: fieldFrom, to: fieldTo, turn0: 31, turn1: 33, yaw0: alongX(fieldTo[0] - fieldFrom[0], fieldTo[1] - fieldFrom[1]), yaw1: field.o.rotation.y };
  // where the field trebuchet is at any time: rolled at a steady walking pace (eased in and out over the first and last
  // 15% of each trip), turned to aim, and turned round to be pushed home
  const ramp = u => { u = clamp01(u); const e = .15, v = 1 / (1 - e); return u < e ? v * u * u / (2 * e) : u > 1 - e ? 1 - v * (1 - u) ** 2 / (2 * e) : v * (u - e / 2); };
  let fieldPath = null, fieldRouteComplete = false, fieldCrewLimit = 0;
  const fieldAt = lt => { const mv = field.move, back = ramp((lt - mv.back0) / (mv.back1 - mv.back0)), k = ramp((lt - mv.t0) / (mv.t1 - mv.t0)) - back, kt = smooth((lt - mv.turn0) / (mv.turn1 - mv.turn0));
    const sample = u => {
      if (!fieldPath) return mv.to;
      let d = fieldPath.total * clamp01(u);
      for (let i = 0; i < fieldPath.lengths.length; i++) { const len = fieldPath.lengths[i]; if (d <= len && len) return [lerp(fieldPath.points[i][0], fieldPath.points[i + 1][0], d / len), lerp(fieldPath.points[i][1], fieldPath.points[i + 1][1], d / len)]; d -= len; }
      return fieldPath.points[fieldPath.points.length - 1];
    };
    const p = sample(k), before = sample(Math.max(0, k - .03)), after = sample(Math.min(1, k + .03));
    const heading = Math.hypot(after[0] - before[0], after[1] - before[1]) > .01 ? alongX(after[0] - before[0], after[1] - before[1]) : mv.yaw0;
    const yaw = lt < mv.back0 - 1 ? heading + wrapA(mv.yaw1 - heading) * kt : mv.yaw1 + wrapA(heading + Math.PI - mv.yaw1) * smooth(lt - mv.back0 + 1);
    return { x: p[0], z: p[1], k, back, yaw }; };
  window.__look = [...engines.map(e => () => [e.o.position.x, e.o.position.y, e.o.position.z]), () => { const q = posAt(lastLt); return [q.x, PLAIN, q.z]; }];   // debug camera targets (city.js ?look=i; the last is the monster)
  const chest = (t) => { const p = posAt(t); return [p.x, Math.max(ground(p.x, p.z), 0) + H * .6, p.z]; };
  const missHouse = D.filter(d => d.kind === 'house' && !d.hits.length).sort((a, b) => Math.hypot(a.x - pts.c[0], a.z - pts.c[1]) - Math.hypot(b.x - pts.c[0], b.z - pts.c[1]))[0];
  const DEFENCE = [   // fire time, engine, what it hits, flight seconds; landings: 25.4 miss, 27.6 bolt, 31.0 boulder, 35.0 boulder, 36.5 bolt, 37.6 field miss, 38.8 castle boulder
    { t: 22.4, e: tre2, hit: 'dino', fl: 3.0 }, { t: 26.6, e: bal, hit: 'dino', fl: 1.0, bolt: true }, { t: 27.6, e: tre1, hit: 'dino', fl: 3.4, big: true },
    { t: 31.8, e: tre2, hit: 'dino', fl: 3.2, big: true }, { t: 35.5, e: bal, hit: 'dino', fl: 1.0, bolt: true }, { t: 35.9, e: field, hit: 'dino', fl: 1.7 },
    { t: 35.2, e: tre1, hit: 'dino', fl: 3.6, big: true },   // the last one lands on his back as he turns to go
  ];
  const FLINCH = DEFENCE.filter(s => s.bolt).map(s => s.t + s.fl);   // small hits: a twitch while he keeps going
  const shots = [];
  for (const s of DEFENCE) {
    const land = s.t + s.fl, from = [s.e.x, s.e.y + s.e.s * (s.bolt ? .6 : 1.6), s.e.z];
    const to = s.hit === 'dino' ? chest(land) : s.hit === 'house' && missHouse ? [missHouse.x, PLAIN + missHouse.h * .7, missHouse.z] : (() => { const p = P(20, 10); return [p[0], ground(...p), p[1]]; })();
    const mesh = s.bolt ? new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 4, 5).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#6b5d55' }))
      : new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), new THREE.MeshLambertMaterial({ color: '#8d8682', flatShading: true }));
    mesh.visible = false; scene.add(mesh); s.e.shots.push(s.t);
    const shot = { ...s, from, to, land, mesh, arc: s.bolt ? 2 : Math.hypot(to[0] - from[0], to[2] - from[2]) * .35 };
    shots.push(shot);
    if (!s.bolt) for (let k = 0; k < s.fl * 14; k++) {   // the boulder burns as it flies: a flame and smoke trail
      const u = k / (s.fl * 14), q = [lerp(from[0], to[0], u), lerp(from[1], to[1], u) + Math.sin(u * Math.PI) * shot.arc, lerp(from[2], to[2], u)];
      fx.add('flame', { born: s.t + u * s.fl, life: .5, p: q, v: [0, 1, 0], size: 2.2, grow: -.8, rot: rr(0, 6), color: '#ffb067', alpha: 1 });
      if (k % 2 === 0) fx.add('smoke', { born: s.t + u * s.fl, life: 2.2, p: q, v: [0, 1.5, 0], drag: .5, size: 1.4, grow: .8, rot: rr(0, 6), color: '#b8aeb6', alpha: .35 });
    }
    // the impact
    fx.flash(land, to, s.bolt ? .8 : 1.4); SHAKES.push({ t: land, a: s.bolt ? .2 : s.big ? .8 : .45 });
    if (s.big) { const p = posAt(land + .3); fx.dust(land + .3, [p.x, PLAIN, p.z], 1.1); fx.debris(land + .2, [p.x, PLAIN + 1, p.z], [0, 0], 1); }   // staggers back, feet scraping
    if (s.hit === 'dino') { fx.dust(land, to, .5, '#d9c9b8'); if (!s.bolt) fx.fire(land, land + 1.2, to, .9); }
    else if (s.hit === 'house' && missHouse) { hit(missHouse, land, { top: missHouse.h * .2, dir: [to[0] - from[0], to[2] - from[2]].map(v => v / Math.hypot(to[0] - from[0], to[2] - from[2])), power: 1.5, at: to }); }
    else { fx.dust(land, to, .9); fx.debris(land, to, [0, 0], 1); fx.ring(land, to, .5); }
  }

  // ---- the soldiers (Kenney Mini Dungeon humans, same family as the Castle Kit): crews push and cheer, archers shoot from the
  // wall, spearmen charge his feet and stab, then cheer and chase him off
  const hk = await ctx.kenneyScene('minidungeon/character-human'), spear = await ctx.kenneyScene('minidungeon/weapon-spear');
  const hb = new THREE.Box3().setFromObject(hk.scene), HS = 2.7 / (hb.max.y - hb.min.y);   // a bit larger than life, so they read next to the monster
  // All of the town's ground-level structures, including unclaimed houses and props,
  // remain blockers even while the monster is breaking part of the town.
  const structures = [...ctx.townPlacements.filter(({ entry }) => entry !== W.entry && entry.y <= Math.max(PLAIN, ground(entry.x, entry.z)) + 1),
    ...ctx.townHouses.filter(h => !h.entry).map(h => ({ model: h.model, entry: { x: h.x, z: h.z, rot: h.rot, s: [h.s, h.s, h.s] } }))];
  const obstacles = [];
  for (const { model, entry: e } of structures) {
    if (Math.hypot(e.x - bx, e.z - bz) > 120) continue;
    const k = await ctx.kenney(model);
    obstacles.push({ model, top: (e.y ?? PLAIN) + k.h * e.s[1], x: e.x, z: e.z, yaw: e.rot, halfX: k.w * e.s[0] / 2 + .8, halfZ: k.d * e.s[2] / 2 + .8 });
  }
  for (const [x, z, scale] of ctx.townTrees) if (Math.hypot(x - bx, z - bz) <= 120)
    obstacles.push({ model: 'tree', top: Math.max(PLAIN, ground(x, z)) + 3.4 * scale, x, z, yaw: 0, halfX: 1.1 * scale + .8, halfZ: 1.1 * scale + .8 });
  // The breach can be prevented by a tap, so ground routes treat the wall as
  // solid throughout the loop, even when its central section is destroyed.
  obstacles.push({ model: 'breach-wall', top: PLAIN + wk.h * W.KW, x: W.x, z: W.z, yaw: W.yaw, halfX: wk.w * W.L / 2 + .8, halfZ: wk.d * W.KW / 2 + .8 });
  for (const e of engines) if (e !== field) {
    e.o.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(e.o);
    e.crewBox = { model: 'siege', top: box.max.y, x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, yaw: 0, halfX: (box.max.x - box.min.x) / 2 + 1, halfZ: (box.max.z - box.min.z) / 2 + 1 };
    obstacles.push(e.crewBox);
  }
  const men = [];
  const man = (plan, armed) => {   // plan: [[t, x, z, clip, yawTarget?], ...] — position eases between keys
    const o = cloneSkinned(hk.scene); o.scale.setScalar(HS); scene.add(o); o.traverse(n => { n.frustumCulled = false; });   // its own skeleton (a plain clone stays bound to the original's, never posed); skinned bounds are stale, so no culling
    if (armed) { const s = spear.scene.clone(); s.scale.setScalar(1); s.rotation.z = -.3; (o.getObjectByName('arm-right') || o).add(s); s.position.set(-.1, -.25, .1); }
    const mixer = new THREE.AnimationMixer(o), acts = {}; for (const c of hk.animations) acts[c.name] = mixer.clipAction(c);
    const m = { o, mixer, acts, plan, cur: null, bones: Object.fromEntries(['root', 'leg-left', 'leg-right', 'torso', 'arm-left', 'arm-right', 'head'].map(n => [n, o.getObjectByName(n)])) };
    const seg = t => { let i = 0; while (i < plan.length - 1 && plan[i + 1][0] <= t) i++; return [plan[i], plan[Math.min(i + 1, plan.length - 1)]]; };
    m.pos = t => { const [a, b] = seg(t), k = b[0] > a[0] ? clamp01((t - a[0]) / (b[0] - a[0])) : 0; return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; };
    m.clipAt = t => { const [a] = seg(t); return [a[3], a[0]]; };   // [clip, since when]
    men.push(m); return m;
  };
  const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
  // Fixed posts are reserved so separate crews never collapse onto one grid point.
  const staticPeople = [];
  const peopleBoxes = points => points.map(([x, z]) => ({ x, z, yaw: 0, halfX: 1.1, halfZ: 1.1 }));
  // crews: three at each engine (the field crew walks it across the fields)
  for (const e of engines) for (let i = 0; i < 3; i++) {
    if (e === field) continue;
    const off = (x, z, r, a) => [x + Math.cos(a) * r, z + Math.sin(a) * r], a0 = e.o.rotation.y + Math.PI / 2 + (i - 1) * .7;
    const radius = Math.min((e.crewBox.halfX + .3) / Math.max(.001, Math.abs(Math.cos(a0))), (e.crewBox.halfZ + .3) / Math.max(.001, Math.abs(Math.sin(a0))));
    const raw = off(e.crewBox.x, e.crewBox.z, radius, a0), p = route(raw, raw, [...obstacles, ...peopleBoxes(staticPeople)])?.[0];
    if (!p) continue; staticPeople.push(p); man([[0, p[0], p[1], 'idle'], [e.shots[0] - .4, p[0], p[1], 'interact-right'], [e.shots[0] + .3, p[0], p[1], 'emote-yes'], [e.shots[0] + 2, p[0], p[1], 'idle'], [LEAVE - 12, p[0], p[1], 'emote-yes']]);
  }
  { // The crew stays at the frame while the entire machine follows a clear route.
    const r0 = field.o.rotation.y, p0 = field.o.position.clone(); field.o.rotation.y = 0; field.o.position.set(0, 0, 0); field.o.updateMatrixWorld(true);
    const fb = new THREE.Box3().setFromObject(field.o); field.o.rotation.y = r0; field.o.position.copy(p0); field.o.updateMatrixWorld(true);
    fieldCrewLimit = Math.hypot(Math.max(Math.abs(fb.min.x), Math.abs(fb.max.x)), Math.max(Math.abs(fb.min.z), Math.abs(fb.max.z)) + 1.1) + .5;
    const mv = field.move, clearance = Math.max(Math.abs(fb.min.z), Math.abs(fb.max.z)) + 1.5;
    const expanded = obstacles.map(o => ({ ...o, halfX: o.halfX + clearance, halfZ: o.halfZ + clearance }));
    const path = route(mv.from, mv.to, expanded, 1.5, 20000);
    fieldRouteComplete = !!path && Math.hypot(path.at(-1)[0] - mv.to[0], path.at(-1)[1] - mv.to[1]) < 2 && Math.hypot(path[0][0] - mv.from[0], path[0][1] - mv.from[1]) < 2 && clearSegment(mv.from, path[0], expanded) && clearSegment(path.at(-1), mv.to, expanded);
    if (fieldRouteComplete) {
      const points = [mv.from, ...path, mv.to], lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
      fieldPath = { points, lengths, total: lengths.reduce((sum, n) => sum + n, 0) };
    }
    const toW = (f, lx, lz) => [f.x + lx * Math.cos(f.yaw) + lz * Math.sin(f.yaw), f.z - lx * Math.sin(f.yaw) + lz * Math.cos(f.yaw)], mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
    const out0 = 33, out1 = 34.4, in0 = mv.back0, in1 = mv.back0 + 1.6;
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? 1 : -1, lx = lerp(fb.min.x, fb.max.x, i % 2 ? .62 : .34), lz = side * ((side > 0 ? fb.max.z : -fb.min.z) + 1.1), far = side * (Math.max(fb.max.x, -fb.min.x) + 2);
      const push = t => { const f = fieldAt(t); return toW(t >= mv.back0 ? { ...f, yaw: f.yaw - Math.PI } : f, lx, lz); }, stand = toW(fieldAt(out1), lx, far);
      const m = man([[0, 0, 0, 'idle']]); m.fieldCrew = true;
      m.pos = t => t < out0 ? push(t) : t < out1 ? mix(push(t), stand, smooth((t - out0) / (out1 - out0))) : t < in0 ? stand : t < in1 ? mix(stand, push(t), smooth((t - in0) / (in1 - in0))) : push(t);
      m.clipAt = t => t >= 36.1 && t < 38 ? ['emote-yes', 36.1] : t >= LEAVE && t < LEAVE + 1.4 ? ['emote-yes', LEAVE] : ['idle', 0];
      m.pushing = t => t < out0 || t >= in1 - .3;
    }
  }
  // Archers remain at their posts, clear of the corner towers, throughout the loop.
  const arrows = [], posts = [], groundPosts = [];
  for (let i = 0; i < 4; i++) { const side = i < 2 ? -1 : 1, a = side * Math.max(0, W.L / 2 - 5) * ((i % 2) ? 1 : .45), at = a => [W.x + Math.cos(W.yaw) * a, W.z - Math.sin(W.yaw) * a];
    const candidates = Array.from({ length: Math.max(1, Math.floor((W.L - 4) * 2)) }, (_, n) => -W.L / 2 + 2 + n * .5).sort((x, y) => Math.abs(x - a) - Math.abs(y - a));
    const post = candidates.find(n => Math.abs(n) >= 7.3 && posts.every(other => Math.abs(n - other) >= 1.8) && !blocked(at(n), obstacles.filter(o => o.model !== 'breach-wall' && o.top > PLAIN + W.KW * 1.25 + .1)));
    let p;
    if (post === undefined) {
      const occupied = peopleBoxes([...staticPeople, ...groundPosts]);
      const path = route(at(a), at(a), [...obstacles, ...occupied]);
      if (!path) continue;
      p = path[0]; groundPosts.push(p);
    } else { posts.push(post); p = at(post); }
    const m = man([[0, ...p, 'idle'], [26.5, ...p, 'holding-both-shoot'], [41, ...p, 'emote-yes'], [LEAVE, ...p, 'idle']]);
    if (post !== undefined) { m.y = PLAIN + W.KW * 1.25; m.wall = true; }
    const y = m.y ?? Math.max(PLAIN, ground(...p));
    for (let k = 0; k < 6; k++) { const tf = 27 + k * 1.9 + i * .25; arrows.push({ t: tf, from: [p[0], y + 1.4, p[1]], fl: .8 }); } }
  // spearmen: out of the streets, at his feet, stabbing; they scatter when he reels, then cheer and give chase
  const crowdObstacles = Object.freeze([...obstacles, ...peopleBoxes([...staticPeople, ...groundPosts])].map(o => Object.freeze(o))), reserved = Array.from({ length: 9 }, () => []);
  const pathSampler = path => {
    const lengths = path.slice(1).map((p, j) => Math.hypot(p[0] - path[j][0], p[1] - path[j][1])), total = lengths.reduce((sum, n) => sum + n, 0);
    return fraction => {
      let distance = total * clamp01(fraction);
      for (let j = 0; j < lengths.length; j++) { if (!lengths[j]) continue; if (distance <= lengths[j]) return [lerp(path[j][0], path[j + 1][0], distance / lengths[j]), lerp(path[j][1], path[j + 1][1], distance / lengths[j])]; distance -= lengths[j]; }
      return path.at(-1);
    };
  };
  const limitPath = (path, maxLength) => {
    const result = [path[0]]; let left = maxLength;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length > left) { if (left > 0) result.push([lerp(a[0], b[0], left / length), lerp(a[1], b[1], left / length)]); break; }
      result.push(b); left -= length;
    }
    return result;
  };
  const peerFrames = new WeakMap();
  const framesFor = person => {
    if (!peerFrames.has(person)) {
      const frames = Array.from({ length: Math.ceil(PER * 10) + 1 }, (_, i) => {
        const p = person.pos(i / 10); return { p, y: person.y ?? Math.max(PLAIN, ground(...p)) };
      });
      frames.bounds = frames.reduce((b, f) => [Math.min(b[0], f.p[0]), Math.min(b[1], f.p[1]), Math.max(b[2], f.p[0]), Math.max(b[3], f.p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
      peerFrames.set(person, frames);
    }
    return peerFrames.get(person);
  };
  const firstConflict = (path, start, end, holdUntil, peers) => {
    const sample = pathSampler(path), bounds = path.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    const frames = peers.map(framesFor).filter(f => f.bounds[2] + 1.5 >= bounds[0] && f.bounds[0] - 1.5 <= bounds[2] && f.bounds[3] + 1.5 >= bounds[1] && f.bounds[1] - 1.5 <= bounds[3]);
    if (!frames.length) return null;
    for (let t = start; t <= holdUntil + .001; t += .1) {
      const p = sample(end > start ? (t - start) / (end - start) : 1), y = Math.max(PLAIN, ground(...p));
      for (const frame of frames) { const other = frame[Math.min(frame.length - 1, Math.max(0, Math.round(t * 10)))], q = other.p;
        if (Math.abs(y - other.y) < 2 && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.5) return p; }
    }
    return null;
  };
  const separated = (...args) => !firstConflict(...args);
  const choosePath = (from, target, occupied, start, end, holdUntil, peers, initial = false, combat = false) => {
    const maxVisited = combat ? 500 : 100, monster = combat ? posAt(35) : null;
    const avoid = peopleBoxes(occupied), first = route(from, target, crowdObstacles, 1.5, maxVisited);
    if (!first) return null;
    const centre = first.at(-1);
    const tryPath = candidate => {
      if (!candidate) return null;
      // The unsnapped end of a previous leg must connect safely to the grid.
      if (!initial && !clearSegment(from, candidate[0], crowdObstacles)) return null;
      const path = initial ? [candidate.at(-1)] : limitPath([from, ...candidate], Math.max(0, (end - start) * 6 - .5));
      if ((combat && Math.hypot(path.at(-1)[0] - monster.x, path.at(-1)[1] - monster.z) > 10.5) || blocked(path.at(-1), avoid) || !separated(path, start, end, holdUntil, peers)) return null;
      // Break up grid alignment without giving up the checked segment or spacing.
      const last = path.at(-1), phase = hashN(from[0] + target[0], from[1] + target[1]) * Math.PI * 2;
      const shifted = [last[0] + Math.cos(phase) * .35, last[1] + Math.sin(phase) * .35];
      const varied = initial ? [shifted] : [...path, shifted];
      if ((!combat || Math.hypot(shifted[0] - monster.x, shifted[1] - monster.z) <= 10.5) && clearSegment(last, shifted, crowdObstacles) && !blocked(shifted, avoid) && separated(varied, start, end, holdUntil, peers)) return varied;
      return path;
    };
    let path = tryPath(first); if (path) return path;
    for (let ring = 1; ring <= (combat ? 2 : 8); ring++) for (let n = 0; n < (combat ? 24 : 12); n++) {
      const angle = n * Math.PI / (combat ? 12 : 6), radius = combat ? 5 + ring * 2 : ring * 1.5;
      const origin = combat ? [monster.x, monster.z] : centre, goal = [origin[0] + Math.cos(angle) * radius, origin[1] + Math.sin(angle) * radius];
      if (blocked(goal, crowdObstacles) || blocked(goal, avoid)) continue;
      path = tryPath(route(from, goal, crowdObstacles, 1.5, Math.min(maxVisited, 30))); if (path) return path;
    }
    return null;
  };
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + [0, .16, -.12, .23, -.19, .08, -.25, .14][i], defender = posAt(35), homeRadius = [6.4, 8.2, 7.3, 9.1, 6.8, 8.6, 7.6, 9][i], ring = [defender.x + Math.cos(a) * (homeRadius - (i === 2 || i === 6 ? 2 : 0)), defender.z + Math.sin(a) * (homeRadius - (i === 2 || i === 6 ? 2 : 0))], home = [defender.x + Math.cos(a) * (homeRadius + (i === 2 || i === 6 ? 0 : 1.5)), defender.z + Math.sin(a) * (homeRadius + (i === 2 || i === 6 ? 0 : 1.5))], back = [pts.c[0] + Math.cos(a) * 11, pts.c[1] + Math.sin(a) * 11];
    const m = man([[0, ...home, 'idle'], [29.4 + i * .08, ...home, 'sprint'], [32, ...ring, 'attack-melee-right'], [38.7, ...ring, 'sprint'], [40, ...back, 'emote-yes'], [41.5, ...back, 'sprint'], [46, ...P([-1, -4, 1, -3, 2, -5, 0, -3][i], [-6, -3, -4, 0, 2, 3, 6, 8][i]), 'emote-yes'], [LEAVE, ...P([-1, -4, 1, -3, 2, -5, 0, -3][i], [-6, -3, -4, 0, 2, 3, 6, 8][i]), 'idle'], [PER - 1, ...home, 'walk']], true); m.spearman = true;
    const legs = [], pending = Array.from({ length: m.plan.length }, () => []); let current = home, unplaceable = false;
    const peers = men.filter(other => other !== m && (other.spearman || other.fieldCrew));
    const firstPath = choosePath(home, home, [...reserved[0], ...reserved[1]], 0, 0, PER - .05, peers, true);
    if (!firstPath) { scene.remove(m.o); men.pop(); continue; }
    current = firstPath.at(-1); pending[0].push(current);
    const placeFallback = reason => {
      const homePost = firstPath[0], depart = 29.4 + i * .08, returnStart = 70 + i * .5;
      for (let radius = 3; radius <= 9; radius += 1.5) for (let n = 0; n < 12; n++) {
        const angle = (n + i) * Math.PI / 6, goal = [homePost[0] + Math.cos(angle) * radius, homePost[1] + Math.sin(angle) * radius];
        const monster = posAt(35);
        if (Math.hypot(goal[0] - monster.x, goal[1] - monster.z) > 10.5) continue;
        const raw = route(homePost, goal, crowdObstacles);
        if (!raw || !clearSegment(homePost, raw[0], crowdObstacles)) continue;
        const out = simplifyPath([homePost, ...raw], crowdObstacles), back = out.slice().reverse();
        const length = out.slice(1).reduce((sum, p, j) => sum + Math.hypot(p[0] - out[j][0], p[1] - out[j][1]), 0);
        if (length < 1.5 || length > 12 || Math.hypot(out.at(-1)[0] - monster.x, out.at(-1)[1] - monster.z) > 10.5) continue;
        const duration = Math.max(1, length / 3), arrive = depart + duration, homeAt = returnStart + duration;
        if (arrive > 32) continue;
        if (!separated(out, depart, arrive, returnStart, peers) || !separated(back, returnStart, homeAt, PER - .05, peers)) continue;
        const outbound = pathSampler(out), inbound = pathSampler(back);
        m.pos = t => t < depart ? homePost : t < arrive ? outbound((t - depart) / duration) : t < returnStart ? out.at(-1) : t < homeAt ? inbound((t - returnStart) / duration) : homePost;
        m.clipAt = t => t >= depart && t < arrive ? ['sprint', depart] : t >= 32 && t < 38.7 ? ['attack-melee-right', 32] : t >= 46 && t < LEAVE ? ['emote-yes', 46] : ['idle', 0];
        m.wanderer = true; m.fallbackReason = reason; m.returnSafe = true;
        pending.forEach((points, k) => { points.length = 0; points.push(m.pos(m.plan[k][0])); reserved[k].push(...points); });
        return;
      }
      m.stationaryFallback = true; m.fallbackReason = reason; m.pos = () => homePost; m.clipAt = t => t >= 32 && t < 38.7 ? ['attack-melee-right', 32] : ['idle', 0]; m.returnSafe = true;
      pending.forEach((points, k) => { points.length = 0; points.push(homePost); reserved[k].push(...points); });
    };
    for (let j = 0; j < m.plan.length - 1; j++) {
      const target = m.plan[j + 1].slice(1, 3);
      let path;
      if (j === m.plan.length - 2) {
        const first = legs[0][0];
        const knownSafe = legs.slice().reverse().flatMap((leg, n) => leg.slice().reverse().slice(n ? 1 : 0));
        path = simplifyPath(knownSafe, crowdObstacles);

      } else if (m.plan[j][1] === target[0] && m.plan[j][2] === target[1]) path = [current];
      else {
        const occupied = [...reserved[j + 1]]; let holdUntil = m.plan[j + 1][0];
        for (let k = j + 2; k < m.plan.length && m.plan[k][1] === target[0] && m.plan[k][2] === target[1]; k++) { occupied.push(...reserved[k]); holdUntil = m.plan[k][0]; }
        path = choosePath(current, target, occupied, m.plan[j][0], m.plan[j + 1][0], holdUntil, peers, false, j === 1);
      }
      if (!path) { m.fallbackReason = `leg ${j}`; unplaceable = true; break; }
      current = path[path.length - 1]; legs.push(path); pending[j + 1].push(current);
    }
    if (unplaceable) { placeFallback(m.fallbackReason); continue; }
    const spans = legs.map(path => {
      const length = path.slice(1).map((p, j) => Math.hypot(p[0] - path[j][0], p[1] - path[j][1]));
      return { path, length, total: length.reduce((sum, n) => sum + n, 0), sample: pathSampler(path) };
    });
    let returning = spans.at(-1); const maxReturn = PER - LEAVE - 1;
    let returnDelay = 0, returnDuration = Math.min(maxReturn, Math.max(.25, returning.total / 3.5)), foundReturn = false;
    const startPoint = returning.path[0], homePoint = returning.path.at(-1), options = [returning.path], detours = [];
    const addDetour = blockers => {
      const candidate = route(startPoint, homePoint, blockers, 1.5, 20000);
      if (candidate && Math.hypot(candidate.at(-1)[0] - homePoint[0], candidate.at(-1)[1] - homePoint[1]) < 1.5 && clearSegment(startPoint, candidate[0], blockers) && clearSegment(candidate.at(-1), homePoint, blockers)) options.push([startPoint, ...candidate, homePoint]);
    };
    for (let attempt = 0; attempt < 4 && !foundReturn && attempt < options.length; attempt++) {
      const path = options[attempt], length = path.slice(1).map((p, j) => Math.hypot(p[0] - path[j][0], p[1] - path[j][1])), total = length.reduce((sum, n) => sum + n, 0);
      const minReturn = Math.min(maxReturn, Math.max(.25, total / 3.5));
      searchReturn: for (let duration = minReturn; duration <= maxReturn + .001; duration += 4) for (let delay = 0; delay + duration <= maxReturn + .001; delay += 4) {
        const start = LEAVE + delay, end = start + duration;
        if (separated([path[0]], LEAVE, LEAVE, start, peers) && separated(path, start, end, PER - .05, peers)) {
          returning = { path, length, total, sample: pathSampler(path) }; returnDelay = delay; returnDuration = duration; foundReturn = true; break searchReturn;
        }
      }
      if (!foundReturn) {
        if (attempt === 0) addDetour(crowdObstacles);
        const collision = firstConflict(path, LEAVE, LEAVE + minReturn, PER - .05, peers);
        if (collision && Math.hypot(collision[0] - startPoint[0], collision[1] - startPoint[1]) > 2 && Math.hypot(collision[0] - homePoint[0], collision[1] - homePoint[1]) > 2) {
          detours.push({ x: collision[0], z: collision[1], yaw: 0, halfX: 1.5, halfZ: 1.5 });
          addDetour([...crowdObstacles, ...detours]);
        }
      }
    }
    if (!foundReturn) { placeFallback('return'); continue; }
    pending.forEach((points, k) => reserved[k].push(...points));
    spans[spans.length - 1] = returning;
    m.returnSafe = foundReturn && Math.hypot(returning.path.at(-1)[0] - homePoint[0], returning.path.at(-1)[1] - homePoint[1]) <= .01 && returning.path.slice(1).every((p, j) => clearSegment(returning.path[j], p, crowdObstacles));
    m.plan[m.plan.length - 1][0] = LEAVE + returnDelay + returnDuration;
    m.pos = t => {
      let i = 0; while (i < m.plan.length - 2 && m.plan[i + 1][0] <= t) i++;
      const a = m.plan[i], b = m.plan[i + 1], delay = i === spans.length - 1 ? returnDelay : 0;
      return spans[i].sample((t - a[0] - delay) / (b[0] - a[0] - delay));
    };
  }
  // Only strike while the moving monster remains within reach.
  for (const m of men.filter(person => person.spearman)) {
    const clipAt = m.clipAt;
    m.clipAt = t => {
      const clip = clipAt(t);
      if (clip[0] !== 'attack-melee-right') return clip;
      const p = m.pos(t), monster = posAt(t);
      return Math.hypot(p[0] - monster.x, p[1] - monster.z) <= 11.9 ? clip : ['idle', clip[1]];
    };
  }
  // walking: the step cycle advances with the ground covered (no sliding feet); slower walkers take shorter strides, as
  // people do; heading turns at most 6 rad/s toward where he is going (or, standing, toward the monster)
  const DT = 1 / 20, NS = Math.ceil(PER / DT) + 2, CYC = { walk: [.54 * HS, .667], sprint: [.59 * HS, .5] };   // metres per cycle (two steps) at full stride, seconds per cycle
  const KX = new Float32Array(NS), KZ = new Float32Array(NS); for (let i = 0; i < NS; i++) { const t = i * DT, q = t < LEAVE ? posAt(t) : { x: pts.away[0], z: pts.away[1] }; KX[i] = q.x; KZ[i] = q.z; }   // where the monster is, once for everyone
  for (const m of men) { m.ph = new Float32Array(NS); m.amp = new Float32Array(NS); m.yaw = new Float32Array(NS); m.mov = []; let ph = 0, yaw = null, [px, pz] = m.pos(PER - DT);
    for (let j = 0; j < NS * 2; j++) { const i = j % NS; if (j === NS) [px, pz] = m.pos(PER - DT);   /* twice round: the second pass starts from where the loop ends, so nothing snaps at the wrap */ const t = i * DT, [x, z] = m.pos(t), d = Math.hypot(x - px, z - pz), v = d / DT, [clip] = m.clipAt(t), gait = v > .25 ? (clip === 'sprint' ? 'sprint' : 'walk') : null;
      const [len, dur] = CYC[gait || 'walk'], a = Math.min(1, Math.max(.35, Math.sqrt(v / (len / dur)))); ph += d / (len * a); m.ph[i] = ph; m.amp[i] = a; m.mov[i] = gait;
      const want = gait ? Math.atan2(x - px, z - pz) : yaw !== null && (m.pushing?.(t) || clip === 'interact-right') ? yaw : Math.atan2(KX[i] - x, KZ[i] - z);
      yaw = yaw === null ? want : yaw + Math.max(-6 * DT, Math.min(6 * DT, wrapA(want - yaw))); m.yaw[i] = yaw; px = x; pz = z; } }
  const ID = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
  window.__men = () => men.map(m => { const q = new THREE.Quaternion(), d = new THREE.Vector3(-1, 0, 0).applyQuaternion(m.bones['arm-right'].getWorldQuaternion(q)), y = m.o.rotation.y;   // debug: heading, where the right arm points (fwd/up), leg swing
    return { p: m.o.position.toArray().map(v => +v.toFixed(2)), yaw: +y.toFixed(2), vis: m.o.visible, push: !!m.pushing, clip: m.cur?.getClip().name, armFwd: +(d.x * Math.sin(y) + d.z * Math.cos(y)).toFixed(2), armUp: +d.y.toFixed(2), leg: +(2 * Math.acos(Math.min(1, Math.abs(m.bones['leg-left'].quaternion.w)))).toFixed(2) }; });
  window.__crowdCheck = t => {
    const propBoxes = [];
    for (const e of engines) { e.o.updateMatrixWorld(true); e.o.traverse(n => { if (n.isMesh && n.visible) { n.geometry.computeBoundingBox(); const scale = new THREE.Vector3().setFromMatrixScale(n.matrixWorld); propBoxes.push({ name: n.name, box: n.geometry.boundingBox, inverse: n.matrixWorld.clone().invert(), scale }); } }); }
    return men.map((m, i) => {
    const position = [m.o.position.x, m.o.position.z], y = m.o.position.y;
    const screen = new THREE.Vector3(position[0], y + 1.35, position[1]).project(ctx.camera);
    return { i, field: !!m.fieldCrew, spearman: !!m.spearman, stationaryFallback: !!m.stationaryFallback, wanderer: !!m.wanderer, fallbackReason: m.fallbackReason, gait: m.mov[Math.min(NS - 1, Math.floor(t / DT))], fieldRouteComplete, fieldCrewLimit, fieldDistance: Math.hypot(position[0] - field.o.position.x, position[1] - field.o.position.z), returnSafe: m.returnSafe, pushing: !!m.pushing?.(t), wall: !!m.wall, position, height: y, clip: m.cur?.getClip().name, monster: [posAt(t).x, posAt(t).z], screen: [screen.x, screen.y], valid: [...position, y, screen.x, screen.y, screen.z].every(Number.isFinite), visible: m.o.visible,
      inView: Math.abs(screen.x) <= 1.05 && Math.abs(screen.y) <= 1.05 && screen.z >= -1 && screen.z <= 1,
      blocked: blocked(position, obstacles.filter(o => !m.wall || (o.model !== 'breach-wall' && o.top > m.y + .1))),
      prop: propBoxes.filter(({ box: b, inverse, scale }) => {
        const foot = new THREE.Vector3(position[0], y + .1, position[1]).applyMatrix4(inverse), head = new THREE.Vector3(position[0], y + 2.7, position[1]).applyMatrix4(inverse);
        return Math.max(foot.y, head.y) > b.min.y && Math.min(foot.y, head.y) < b.max.y && foot.x >= b.min.x - .5 / scale.x && foot.x <= b.max.x + .5 / scale.x && foot.z >= b.min.z - .5 / scale.z && foot.z <= b.max.z + .5 / scale.z;
      }).map(({ name }) => ({ name })) };
    });
  };
  const arrowMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(.04, .04, 1.4, 4).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#5e4a44' }), arrows.length);
  arrowMesh.frustumCulled = false; scene.add(arrowMesh);
  for (const ar of arrows) ar.to = chest(ar.t + ar.fl);

  // splashes while he wades, and fires in the worst-hit houses
  for (let t = 0; t < LEAVE; t += .45) { const p = posAt(t); if (ground(p.x, p.z) < 0) fx.splash(t, [p.x + rr(-1.5, 1.5), p.z + rr(-1.5, 1.5)], 1.2); }
  const wrecked = D.filter(d => d.hits.length).sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz));
  wrecked.forEach((d, i) => { d.rebuild = d.kind === 'wall' ? LEAVE + 4 : LEAVE + 2 + i * (32 / Math.max(1, wrecked.length)); });
  wrecked.filter(d => d.kind === 'house' && d.brokenTo < d.h * .5).slice(0, 5).forEach((d, i) => {
    d.burns = true; const t0 = d.hits[0] + 1 + i * .7; fx.tag = d.hitTags[0]; fx.fire(t0, d.rebuild - 2, [d.x, PLAIN + Math.max(.5, d.brokenTo), d.z], 1.7); fx.decal(t0, d.rebuild + 9, 'scorch', [d.x, PLAIN, d.z], 7); fx.tag = null;
  });
  for (const d of wrecked) { d.sc = ctx.scaffold(d.kind === 'wall' ? 10 : d.r * 1.6 + .9, d.kind === 'wall' ? 3 : d.r * 1.6 + .9, d.h + .8, ctx.steps(d.h)); const sa = d.kind === 'wall' ? d.spanAt || 0 : 0; d.sc.position.set(d.x + Math.cos(d.yaw) * sa, PLAIN, d.z - Math.sin(d.yaw) * sa); d.sc.rotation.y = d.kind === 'wall' ? d.yaw : 0; scene.add(d.sc); }   // a wall's scaffold goes up over its gap
  // ---- sound (Kenney CC0, tools/sounds.sh): footfalls (a low rumble while he wades), smashes, the stomp, roars, the castle's
  // shots and their hits, arrows, then hammering while each house is rebuilt. { t, s: name, v: volume, r: rate }
  const SND = [], sn = (t, s, v = 1, r = 1, tag = null) => SND.push({ t: +t.toFixed(3), s, v, r, tag }), pick = (b, n) => `${b}_00${Math.floor(rnd() * n)}`;
  for (const s of S) if (s.kind === 'move') { const st = s.clip === 'Run' ? .42 : .8;
    for (let t = s.t0 + .2; t < Math.min(s.t1, LEAVE + 3); t += st) { const p = posAt(t), wet = ground(p.x, p.z) < 0;
      if (wet) { sn(t, 'lowFrequency_explosion_00' + Math.floor(rnd() * 2), .32, rr(.4, .5)); sn(t + .02, pick('impactSoft_heavy', 3), .35, .4); } else { sn(t, pick('impactSoft_heavy', 3), .7, .5); sn(t + .01, 'lowFrequency_explosion_000', .15, 1.6); } } }
  { const last = new Map(); for (const [t, tag] of D.flatMap(d => d.hits.map((t, i) => [t, d.hitTags[i]])).sort((a, b) => a[0] - b[0])) { if (t - (last.get(tag) ?? -9) < .15) continue; last.set(tag, t); sn(t, pick('explosionCrunch', 5), .7, 1, tag); sn(t + .03, pick('impactWood_heavy', 5), .5, 1, tag); } }
  for (const im of IMPACT_SND) { sn(im.t, 'lowFrequency_explosion_00' + Math.floor(rnd() * 2), .8, rr(.8, 1.05), im.tag); sn(im.t + .02, pick('explosionCrunch', 5), .9, rr(.8, 1), im.tag); sn(im.t + rr(.05, .15), 'stoneHit' + (1 + Math.floor(rnd() * 3)), .6, rr(.7, .9), im.tag); }
  for (const s of S) { if (s.clip === 'Jump_Land') { const tag = ATK.find(a => a.segs.includes(s)).tag; sn(s.t0 + .1, 'lowFrequency_explosion_001', 1, 1, tag); sn(s.t0 + .12, 'explosionCrunch_004', .8, 1, tag); }
    if (s.clip === 'Yes' || s.clip === 'No') sn(s.t0 + .1, 'creature' + (1 + Math.floor(rnd() * 5)), .8, .45); }   // a roar, slowed down
  for (const s of shots) { sn(s.t, s.bolt ? 'woosh3' : 'woosh1', .5, s.bolt ? 1.3 : .6); if (!s.bolt) sn(s.t, pick('impactWood_heavy', 5), .4, .7);
    sn(s.land, s.bolt ? 'impactPunch_heavy_000' : 'stoneHit2', .8); if (!s.bolt) sn(s.land + .02, 'explosionCrunch_003', .7); }
  for (const ar of arrows) if (rnd() < .5) sn(ar.t, 'woosh3', .15, 1.6);
  for (const d of wrecked) for (let t = d.rebuild + .3; t < d.rebuild + 9; t += rr(.4, 1)) sn(t, rnd() < .3 ? pick('impactPlank_medium', 5) : rnd() < .5 ? 'chop' : pick('impactWood_light', 5), .22, rr(.9, 1.1), 'h' + D.indexOf(d));
  SND.sort((a, b) => a.t - b.t);
  // ---- the Easter egg: tap him and he takes the hit (one of six reactions, a burst and a thump). A hit during a blow's
  // wind-up stops the blow: its breaks, flying pieces, dust, fire and sound never happen. His route, the defenders' shots
  // and the last boulder that sends him off are unchanged, so the scene still plays out; taps reset with each loop.
  const REACT = [{ clip: 'HitReact', rate: 1.3, dur: .7, twist: .35 }, { clip: 'HitReact', rate: .9, dur: .9, twist: -.35, lean: -.12 }, { clip: 'Duck', rate: 1.5, dur: .8, twist: 0 },
    { clip: 'Death', rate: 1.4, dur: .6, twist: .2, lean: -.15 }, { clip: 'No', rate: 1.8, dur: .8, twist: -.2 }, { clip: 'Jump_Land', rate: .9, dur: .7, twist: .12 }];
  const taps = [], cancelled = new Map();   // attack tag -> when it was stopped
  let lastLt = 0;
  const deadTag = tag => tag[0] === 'h' ? (() => { const d = D[+tag.slice(1)]; return !d.versions.some((x, i) => i && !(x.tag != null && cancelled.has(x.tag))); })() : cancelled.has(tag);
  const alive = x => !(x.tag != null && cancelled.has(x.tag));
  fx.dead = deadTag; fx.reserve(6);
  window.__egg = { ...window.__egg, route: { pts, path: Array.from({ length: Math.ceil(LEAVE) + 1 }, (_, i) => { const q = posAt(Math.min(i, LEAVE - .01)); return [i, +q.x.toFixed(1), +q.z.toFixed(1), q.s.clip]; }), houses: D.filter(d => d.kind === 'house').length, props: D.filter(d => d.kind !== 'house').map(d => [d.kind, +d.x.toFixed(1), +d.z.toFixed(1), d.hits.map(h => +h.toFixed(1))]), punches: S.filter(s => s.target).map(s => [+s.t0.toFixed(1), s.clip, +Math.hypot(s.target.x - s.from[0], s.target.z - s.from[1]).toFixed(1)]) }, kaiju: { ATK: ATK.map(k => ({ tag: k.tag, from: +k.from.toFixed(2), tc: +k.tc.toFixed(2), clip: k.segs[k.segs.length - 1].clip })), cancelled, taps } };   // debug
  fx.build();

  return {
    per: PER, sounds: SND, loops: [], dead: deadTag,
    tap(nx, ny, t, cam) {
      const lt = ((t % PER) + PER) % PER; if (lt >= LEAVE - 2) return false;
      const p = posAt(lt);
      // on his body: rays through the finger and a ring around it (a fingertip's slop), so a tap just off his outline counts
      const ray = new THREE.Raycaster(), at = (dx, dy) => { ray.setFromCamera(new THREE.Vector2(nx * 2 - 1 + dx / cam.aspect, 1 - ny * 2 + dy), cam); return ray.intersectObject(M.g, true)[0]?.point; };
      let hitP = at(0, 0); for (let i = 0; i < 8 && !hitP; i++) hitP = at(Math.cos(i * Math.PI / 4) * .06, Math.sin(i * Math.PI / 4) * .06);
      if (!hitP) return false;
      const toCam = [cam.position.x - p.x, cam.position.z - p.z], tl = Math.hypot(...toCam) || 1, away = [-toCam[0] / tl, -toCam[1] / tl];
      taps.push({ t: lt, v: (taps.length * 7 + Math.floor(lt * 3)) % REACT.length, away });
      for (const k of ATK) if (!cancelled.has(k.tag) && lt >= k.from && lt <= k.tc) cancelled.set(k.tag, lt);
      fx.burst(lt, [hitP.x, hitP.y, hitP.z], 1.3);
      ctx.sfx(`impactPunch_heavy_00${taps.length % 5}`, .9, .9 + (taps.length % 3) * .1); ctx.sfx('impactSoft_heavy_00' + (taps.length % 3), .5, .7);
      if (taps.length % 3 === 0) ctx.sfx('creature' + (1 + taps.length % 5), .7, .5);   // every third hit, a roar
      return true;
    },
    update(t) {
      const lt = ((t % PER) + PER) % PER;
      if (lt < lastLt - 1) { taps.length = 0; cancelled.clear(); } lastLt = lt;   // a new loop: the town as scripted again
      // the monster
      M.g.visible = lt < LEAVE;
      if (M.g.visible) {
        const p = posAt(lt), s = p.s, prev = S[S.indexOf(s) - 1];
        const under = Math.max(1 - smooth(lt / 6), smooth((lt - (LEAVE - 6)) / 6)) * (H + 2);   // he walks up out of the sea, and back down into it
        M.g.position.set(p.x, Math.max(ground(p.x, p.z), -(H + 2)) - under, p.z); M.g.rotation.y = p.yaw;   // as deep as the sea floor
        const actOf = g => M.actions[g.clip] || M.actions.Walk;
        const timeOf = (g, t) => { const d = actOf(g).getClip().duration, r = g.rate || 1;
          return g.kind === 'move' || g.clip === 'Idle' ? (t * r) % d : Math.min((t - g.t0) * r, d - 1e-3); };   // acts play once and hold
        M.mixer.stopAllAction();
        const stopped = ATK.find(k => k.segs.includes(s) && cancelled.has(k.tag) && lt >= cancelled.get(k.tag));
        const a = stopped ? M.actions.Idle : actOf(s), fade = prev ? clamp01((lt - s.t0) / .3) : 1;   // 0.3 s crossfade from the last segment's pose; a stopped blow stands down
        let wa = 1;
        if (prev && fade < 1 && actOf(prev) !== a) { const b = actOf(prev); b.play(); b.time = timeOf(prev, Math.min(lt, prev.t1 + (prev.kind === 'move' ? lt - s.t0 : 0))); b.setEffectiveWeight(1 - fade); wa = fade; }
        const fl = FLINCH.find(x => lt >= x && lt < x + .45);
        if (fl !== undefined && s.clip !== 'HitReact') { const h = M.actions.HitReact, w = .6 * Math.sin(Math.PI * (lt - fl) / .45); h.play(); h.time = Math.min((lt - fl) * 1.3, h.getClip().duration - 1e-3); h.setEffectiveWeight(w); wa *= 1 - w; }
        // the player's hit: the newest tap's reaction over everything else (half strength during a blow that can't be stopped)
        const tp = taps[taps.length - 1], ra = tp ? lt - tp.t : -1, R = tp && REACT[tp.v];
        if (R && ra >= 0 && ra < R.dur) { const act = M.actions[R.clip], used = act === a || (fl !== undefined && act === M.actions.HitReact);
          const cap = s.clip === 'Punch' && s.face ? .45 : 1, w = cap * Math.min(1, ra / .08) * (1 - smooth((ra - (R.dur - .3)) / .3));
          if (!used) { act.play(); act.time = Math.min(ra * R.rate, act.getClip().duration - 1e-3); act.setEffectiveWeight(w); wa *= 1 - w; }
          const env = Math.sin(Math.PI * Math.min(1, ra / R.dur)); M.g.rotation.y += R.twist * env * cap; M.g.rotation.x = (R.lean || 0) * env * cap;
          M.g.position.x += tp.away[0] * .6 * env * cap; M.g.position.z += tp.away[1] * .6 * env * cap; }   // rocked back a little, away from the blow
        else M.g.rotation.x = 0;
        if (stopped) { a.play(); a.time = (lt * .8) % a.getClip().duration; a.setEffectiveWeight(wa); } else { a.play(); a.time = timeOf(s, lt); a.setEffectiveWeight(wa); }
        M.mixer.update(0);
      }
      // the destructibles: show the version for this moment, fly the chunks, sink rubble, rebuild in scaffolding
      for (const d of D) {
        let v = d.versions[0]; for (const x of d.versions) if (x.t <= lt && alive(x)) v = x;
        const saved = d.rebuild && !d.versions.some((x, i) => i && alive(x));   // every blow on it was stopped: nothing to rebuild
        const rebuilding = d.rebuild && !saved && lt >= d.rebuild, built = d.rebuild && lt >= d.rebuild + 9 + 4;
        for (const x of d.versions) x.mesh.visible = false;
        if (!d.rebuild || saved || lt < d.rebuild) v.mesh.visible = true;
        d.mat.uniforms.cut.value = 9999;
        if (rebuilding) { d.whole.visible = true; const k = (lt - d.rebuild) / 9, n = ctx.steps(d.h);
          if (k < 1) { d.mat.uniforms.cut.value = PLAIN + d.h * ctx.stepped(k, d.h); ctx.layers(d.sc, Math.min(n, k * n + .55) + .45); }
          else ctx.layers(d.sc, built ? 0 : n - (lt - d.rebuild - 9) / .4); }
        else if (d.sc) ctx.layers(d.sc, 0);
        for (const c of d.chunks) {
          const a = lt - c.t0, sink = d.rebuild ? clamp01((lt - (d.rebuild - 2)) / 2) : 0;
          c.m.visible = a >= 0 && sink < 1 && alive(c); if (!c.m.visible) continue;
          const i = Math.min(c.frames.length / 7 - 1, Math.floor(a * 30)) * 7, f = c.frames;
          c.m.position.set(f[i], f[i + 1] - sink * 2, f[i + 2]); c.m.quaternion.set(f[i + 3], f[i + 4], f[i + 5], f[i + 6]);
        }
      }
      if (field.move) { const f = fieldAt(lt);
        field.o.position.set(f.x, ground(f.x, f.z), f.z); field.o.rotation.y = f.yaw;   // turned round to be pushed home
        field.x = f.x; field.z = f.z;
        field.o.traverse(n => { if (n.name === 'wheel') n.rotation.z = -(f.k + 2 * f.back) * 12; }); }
      for (const m of men) {
        const i = Math.min(NS - 2, Math.floor(lt / DT)), f = lt / DT - i, [x, z] = m.pos(lt), gait = m.mov[i], [clip, since] = m.clipAt(lt), B = m.bones;
        m.o.visible = true; m.o.position.set(x, m.y ?? Math.max(PLAIN, ground(x, z)), z);
        m.o.rotation.y = m.yaw[i] + wrapA(m.yaw[i + 1] - m.yaw[i]) * f;
        const act = m.acts[gait || (clip === 'sprint' || clip === 'walk' ? 'idle' : clip)] || m.acts.idle;
        if (m.cur !== act) { m.mixer.stopAllAction(); act.reset().play(); m.cur = act; }
        const ph = lerp(m.ph[i], m.ph[i + 1], f), dur = act.getClip().duration;
        act.time = gait ? (ph % 1) * dur : (lt - since) % dur; m.mixer.update(0);
        if (gait) { const a = lerp(m.amp[i], m.amp[i + 1], f); B['leg-left'].quaternion.slerp(ID, 1 - a); B['leg-right'].quaternion.slerp(ID, 1 - a); B.root.position.y *= a; }   // shorter strides when slow
        if (m.pushing?.(lt)) {   // arms out in front on the frame, shoving with each step; leaning into it
          const pump = gait ? Math.sin(ph * Math.PI * 4) * .12 : 0;
          B['arm-right'].quaternion.setFromAxisAngle(AY, 1.25 + pump); B['arm-left'].quaternion.setFromAxisAngle(AY, -1.25 - pump);   /* the rig's arms point sideways at rest; it faces +z */
          B.torso.quaternion.setFromAxisAngle(AX, .3); B.head.quaternion.setFromAxisAngle(AX, -.22);
        }
      }
      { const o = new THREE.Object3D(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
        arrows.forEach((ar, i) => { const k = (lt - ar.t) / ar.fl; if (k < 0 || k > 1) { arrowMesh.setMatrixAt(i, zero); return; }
          const x = lerp(ar.from[0], ar.to[0], k), y = lerp(ar.from[1], ar.to[1], k) + Math.sin(k * Math.PI) * 3, z = lerp(ar.from[2], ar.to[2], k);
          o.position.set(x, y, z); o.lookAt(ar.to[0], ar.to[1], ar.to[2]); o.updateMatrix(); arrowMesh.setMatrixAt(i, o.matrix); });
        arrowMesh.instanceMatrix.needsUpdate = true; }
      for (const e of engines) {   // the trebuchet's arm swings through each throw; the ballista's bolt is gone once fired
        const since = Math.min(...e.shots.map(s => lt - s).filter(a => a >= 0), 99);
        if (e.arm) e.arm.rotation.z = since < 2.4 ? -Math.sin(Math.min(1, since / .4) * Math.PI / 2) * 2.5 * (1 - smooth((since - .7) / 1.7)) : 0;   /* the sling end swings up over the top, then the arm settles back */
        if (e.arrow) e.arrow.visible = since > 4 || since === 99;
        if (e.loaded) e.loaded.visible = e.shots.some(s => s > lt) && (since > 3.5 || since === 99);   // thrown, then the crew loads the next one
      }
      for (const s of shots) {
        const k = (lt - s.t) / s.fl; s.mesh.visible = k >= 0 && (s.bolt ? k < 1 + 2.5 / s.fl : k < 1);
        if (!s.mesh.visible) continue;
        const u = Math.min(1, k), x = lerp(s.from[0], s.to[0], u), y = lerp(s.from[1], s.to[1], u) + Math.sin(u * Math.PI) * s.arc, z = lerp(s.from[2], s.to[2], u);
        if (s.bolt && k >= 1 && s.hit === 'dino') { const c = chest(lt); s.mesh.position.set(c[0], c[1], c[2]); }   // the bolt sticks in him
        else s.mesh.position.set(x, y, z);
        s.mesh.lookAt(s.to[0], s.to[1], s.to[2]); s.mesh.rotation.z += lt * 4 * (s.bolt ? 0 : 1);
      }
      fx.update(lt);
    },
    // a camera from over the bay, three-quarter on the breach, shaking with each blow
    // the main shot's angle, pulled back and turned a touch toward the market so the other scenes fit: the menu holds it
    // still (cam=menu)
    view(aspect, also) { const port = aspect < 1, f = P(7, -3), w = port ? .5 : .4, l = also ? [lerp(f[0], also[0], w), lerp(f[1], also[1], w)] : f, k = port ? 2.1 : 1.45;   // phones: further back
      return { fov: port ? 66 : 44, pos: [l[0] - (nx - sx) * 40 * k, PLAIN + 30 * k, l[1] - (nz - sz) * 40 * k], look: [l[0], PLAIN + 5, l[1]] }; },
    camera(cam, t, aspect) {
      const lt = ((t % PER) + PER) % PER, f = P(7, -3);
      let sh = 0; for (const s of SHAKES) { const a = lt - s.t; if (a >= 0 && a < 1.2 && !(s.tag != null && deadTag(s.tag))) sh += s.a * Math.exp(-a * 4); }
      if (lt >= 27 && lt < 39.6) {   // during the defence: from behind the field trebuchet, the Dino and the soldiers at his feet
        const to = [pts.c[0] - field.x, pts.c[1] - field.z], l = Math.hypot(...to), d = [to[0] / l, to[1] / l], sd = [d[1], -d[0]];
        cam.fov = aspect < 1 ? 64 : 46;
        cam.position.set(field.x - d[0] * 12 + sd[0] * 8 + Math.sin(lt * 37) * sh, ground(field.x, field.z) + 21 + Math.sin(lt * 53) * sh, field.z - d[1] * 12 + sd[1] * 8 + Math.cos(lt * 41) * sh);
        cam.lookAt(lerp(field.x, pts.c[0], .7), PLAIN + 4, lerp(field.z, pts.c[1], .7)); cam.aspect = aspect; cam.updateProjectionMatrix(); return;
      }
      cam.fov = aspect < 1 ? 62 : 44;
      cam.position.set(f[0] - nx * 40 + sx * 40 + Math.sin(lt * 37) * sh, PLAIN + 30 + Math.sin(lt * 53) * sh, f[1] - nz * 40 + sz * 40 + Math.cos(lt * 41) * sh);
      cam.lookAt(f[0], PLAIN + 5, f[1]); cam.aspect = aspect; cam.updateProjectionMatrix();
    },
  };
}
