const params = new URLSearchParams(location.search);
const variant = params.get('variant');
if (variant === 'b' || variant === 'c') document.body.classList.add(`variant-${variant}`);
const ICONS: Record<string, string> = {
  admin:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M128 24 40 56v64c0 56 36 96 88 112 52-16 88-56 88-112V56Zm0 72a24 24 0 1 0 0 48 24 24 0 0 0 0-48Zm-40 80c12-18 27-24 40-24s28 6 40 24"/></g></svg>',
  agent:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><rect x="40" y="88" width="176" height="120" rx="28"/><path d="M128 88V40M96 148h.01M160 148h.01" /></g></svg>',
  bit16:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M224,64V192a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V64a8,8,0,0,1,8-8H216A8,8,0,0,1,224,64Z" opacity="0.2"/><path d="M216,48H40A16,16,0,0,0,24,64V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48ZM104,144V112h48v32Zm48,16v32H104V160ZM40,112H88v32H40Zm64-16V64h48V96Zm64,16h48v32H168Zm48-16H168V64h48ZM88,64V96H40V64ZM40,160H88v32H40Zm176,32H168V160h48v32Z"/></svg>',
  bots: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M200,56H56A24,24,0,0,0,32,80V192a24,24,0,0,0,24,24H200a24,24,0,0,0,24-24V80A24,24,0,0,0,200,56ZM164,184H92a20,20,0,0,1,0-40h72a20,20,0,0,1,0,40Z" opacity="0.2"/><path d="M200,48H136V16a8,8,0,0,0-16,0V48H56A32,32,0,0,0,24,80V192a32,32,0,0,0,32,32H200a32,32,0,0,0,32-32V80A32,32,0,0,0,200,48Zm16,144a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V80A16,16,0,0,1,56,64H200a16,16,0,0,1,16,16ZM72,108a12,12,0,1,1,12,12A12,12,0,0,1,72,108Zm88,0a12,12,0,1,1,12,12A12,12,0,0,1,160,108Zm4,28H92a28,28,0,0,0,0,56h72a28,28,0,0,0,0-56Zm-24,16v24H116V152ZM80,164a12,12,0,0,1,12-12h8v24H92A12,12,0,0,1,80,164Zm84,12h-8V152h8a12,12,0,0,1,0,24Z"/></svg>',
  brush:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M224 32c-48 8-96 56-120 96l24 24c40-24 88-72 96-120Z"/><path d="M104 128c-32 0-48 24-48 48s-16 40-24 40h64a56 56 0 0 0 56-56"/></g></svg>',
  bug: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M84 120a44 44 0 0 1 88 0v36a44 44 0 0 1-88 0ZM100 84a28 28 0 0 1 56 0M128 120v80M84 132H48M172 132h36M88 176l-32 20M168 176l32 20M92 96 64 76M164 96l28-20"/></g></svg>',
  build:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(35 128 136)"><path d="M68 52h104v48H68ZM120 100v128M172 64h20v24h-20"/></g></g></svg>',
  bulb: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M96 184v-12a72 72 0 1 1 64 0v12Z"/><path d="M100 216h56M128 184v-48M108 140l20-20 20 20"/></g></svg>',
  cartoon:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z" opacity="0.2"/><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216ZM80,108a12,12,0,1,1,12,12A12,12,0,0,1,80,108Zm104,0a8,8,0,0,1-8,8H152a8,8,0,0,1,0-16h24A8,8,0,0,1,184,108Zm-9.08,48c-10.29,17.79-27.39,28-46.92,28s-36.63-10.2-46.92-28a8,8,0,1,1,13.84-8c7.47,12.91,19.21,20,33.08,20s25.61-7.1,33.08-20a8,8,0,1,1,13.84,8Z"/></svg>',
  chat: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M44 56h168v112H120l-48 40v-40H44Z"/><path d="M92 112h.01M128 112h.01M164 112h.01" stroke-width="24"/></g></svg>',
  check:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="m40 136 56 56L216 72"/></g></svg>',
  chest:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><g transform="scale(10.667)" stroke-width="1.5"><rect x="3" y="9" width="18" height="11" rx="1"/><path d="M3 9a9 4 0 0 1 18 0M12 12v3"/></g></g></svg>',
  cloud:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M80 192a48 48 0 1 1 12-94 64 64 0 0 1 124 22 36 36 0 0 1-8 72Z"/></g></svg>',
  decisions:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M44 56h168v112H120l-48 40v-40H44Z"/><path d="M108 96a20 20 0 1 1 28 18c-6 3-8 7-8 14M128 148v2"/></g></svg>',
  edit: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="m48 176-8 40 40-8L200 88l-32-32Z"/><path d="m144 80 32 32"/></g></svg>',
  eye: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M128 56C48 56 16 128 16 128s32 72 112 72 112-72 112-72-32-72-112-72Z"/><circle cx="128" cy="128" r="40"/></g></svg>',
  games:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><rect x="40" y="40" width="72" height="72" rx="12"/><rect x="144" y="40" width="72" height="72" rx="12"/><rect x="40" y="144" width="72" height="72" rx="12"/><rect x="144" y="144" width="72" height="72" rx="12"/></g></svg>',
  hammer:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M245.66,129,217,157.66a8,8,0,0,1-11.3,0L168.1,120l-28,28-32-32,28-28L80,31.78a87.81,87.81,0,0,1,98.31,18l67.35,67.89A8,8,0,0,1,245.66,129Z" opacity="0.2"/><path d="M251.34,112,183.88,44.08a96.1,96.1,0,0,0-135.77,0l-.09.09L34.25,58.4A8,8,0,0,0,45.74,69.53L59.47,55.35a79.92,79.92,0,0,1,18.71-13.9L124.68,88l-96,96a16,16,0,0,0,0,22.63l20.69,20.69a16,16,0,0,0,22.63,0l96-96,14.34,14.34h0L200,163.3a16,16,0,0,0,22.63,0l28.69-28.69A16,16,0,0,0,251.34,112ZM60.68,216,40,195.31l68-68L128.68,148ZM162.34,114.32,140,136.67,119.31,116l22.35-22.35a8,8,0,0,0,0-11.32L94.32,35a80,80,0,0,1,78.23,20.41l44.22,44.51L188,128.66l-14.34-14.34A8,8,0,0,0,162.34,114.32Zm49,37.66-12-12L228,111.25l12,12Z"/></svg>',
  iso: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M224,80l-96,56L32,80l96-56Z" opacity="0.2"/><path d="M230.91,172A8,8,0,0,1,228,182.91l-96,56a8,8,0,0,1-8.06,0l-96-56A8,8,0,0,1,36,169.09l92,53.65,92-53.65A8,8,0,0,1,230.91,172ZM220,121.09l-92,53.65L36,121.09A8,8,0,0,0,28,134.91l96,56a8,8,0,0,0,8.06,0l96-56A8,8,0,1,0,220,121.09ZM24,80a8,8,0,0,1,4-6.91l96-56a8,8,0,0,1,8.06,0l96,56a8,8,0,0,1,0,13.82l-96,56a8,8,0,0,1-8.06,0l-96-56A8,8,0,0,1,24,80Zm23.88,0L128,126.74,208.12,80,128,33.26Z"/></svg>',
  layers:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="m32 176 96 56 96-56"/><path d="m32 128 96 56 96-56"/><path d="m32 80 96 56 96-56-96-56Z"/></g></svg>',
  link: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M122.66,194.34a8,8,0,0,1,0,11.32l-16,16a56,56,0,0,1-79.2-79.2l40-40a56,56,0,0,1,79.2,0,8,8,0,0,1-11.32,11.32,40,40,0,0,0-56.56,0l-40,40a40,40,0,0,0,56.56,56.56l16-16A8,8,0,0,1,122.66,194.34Z"/><path d="M240,88a56,56,0,0,1-16.4,39.6l-40,40a56,56,0,0,1-79.2,0,8,8,0,0,1,11.32-11.32,40,40,0,0,0,56.56,0l40-40a40,40,0,0,0-56.56-56.56l-16,16a8,8,0,0,1-11.32-11.32l16-16A56,56,0,0,1,240,88Z"/></svg>',
  lowpoly:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M137,65A24,24,0,1,1,137,31,24,24,0,0,1,137,65ZM23,103A24,24,0,1,0,57,103,24,24,0,0,0,23,103Zm120,88A24,24,0,1,0,177,191,24,24,0,0,0,143,191ZM225,55A24,24,0,1,0,225,89,24,24,0,0,0,225,55Z" opacity="0.2"/><path d="M230.64,49.36a32,32,0,0,0-45.26,0h0a31.9,31.9,0,0,0-5.16,6.76L152,48.42A32,32,0,0,0,97.37,25.36h0a32.06,32.06,0,0,0-5.76,37.41L57.67,93.32a32.05,32.05,0,0,0-40.31,4.05h0a32,32,0,0,0,42.89,47.41l70,51.36a32,32,0,1,0,47.57-14.69l27.39-77.59q1.38.12,2.76.12a32,32,0,0,0,22.63-54.62Zm-122-12.69h0a16,16,0,1,1,0,22.64A16,16,0,0,1,108.68,36.67Zm-80,94.65a16,16,0,0,1,0-22.64h0a16,16,0,1,1,0,22.64Zm142.65,88a16,16,0,0,1-22.63-22.63h0a16,16,0,1,1,22.63,22.63Zm-8.55-43.18a32,32,0,0,0-23,7.08l-70-51.36a32.17,32.17,0,0,0-1.34-26.65l33.95-30.55a32,32,0,0,0,45.47-10.81L176,71.56a32,32,0,0,0,14.12,27Zm56.56-92.84A16,16,0,1,1,196.7,60.68h0a16,16,0,0,1,22.63,22.63Z"/></svg>',
  map: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M96 48 32 72v136l64-24 64 24 64-24V48l-64 24Z"/><path d="M96 48v136M160 72v136"/></g></svg>',
  pencil:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M221.66,90.34,192,120,136,64l29.66-29.66a8,8,0,0,1,11.31,0L221.66,79A8,8,0,0,1,221.66,90.34Z" opacity="0.2"/><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg>',
  person:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><circle cx="128" cy="72" r="36"/><path d="M56 216v-32a72 72 0 0 1 144 0v32"/></g></svg>',
  pixel:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M40 40h176v176H40Z" opacity="0.2"/><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><rect x="40" y="40" width="176" height="176" rx="12"/><path d="M84 40v176M128 40v176M172 40v176M40 84h176M40 128h176M40 172h176"/></g></svg>',
  play: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M88 56v144l112-72Z"/></g></svg>',
  pointer:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M56 40 104 216l28-84 84-28Z"/></g></svg>',
  search:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><g transform="scale(10.667)" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></g></g></svg>',
  send: '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M224 32 112 144M224 32l-72 192-40-80-80-40Z"/></g></svg>',
  settings:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><circle cx="128" cy="128" r="32"/><path d="M128 32v24M128 200v24M32 128h24M200 128h24M60 60l17 17M179 179l17 17M60 196l17-17M179 77l17-17"/></g></svg>',
  sketch:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M221.66,90.34,192,120,136,64l29.66-29.66a8,8,0,0,1,11.31,0L221.66,79A8,8,0,0,1,221.66,90.34Z" opacity="0.2"/><path d="M227.32,73.37,182.63,28.69a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H216a8,8,0,0,0,0-16H115.32l112-112A16,16,0,0,0,227.32,73.37ZM48,163.31l88-88L180.69,120l-88,88H48Zm144-54.62L147.32,64l24-24L216,84.69Z"/></svg>',
  versions:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M72 48v112a40 40 0 0 0 40 40h72M72 88h48a32 32 0 0 0 32-32v-8M152 48l-20-20M152 48l20-20M184 200l-20-20M184 200l-20 20"/></g></svg>',
  volume:
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M40 100h36l52-44v144l-52-44H40ZM168 100a40 40 0 0 1 0 56M196 76a76 76 0 0 1 0 104"/></g></svg>',
};
const STRIPS: Record<string, [string, number, number, number]> = {
  'k2-hero': ['k2-hero.webp', 2, 133, 160],
  'k2-hero-pink': ['k2-hero-pink.webp', 2, 133, 160],
  'k2-slime': ['k2-slime.webp', 2, 121, 100],
  'k2-bee': ['k2-bee.webp', 2, 134, 110],
  'k2-snail': ['k2-snail.webp', 2, 121, 100],
};
const ic = (n: string | undefined) => (n ? ICONS[n] || '' : '');
document.querySelectorAll<HTMLElement>('[data-icon]').forEach((e) => (e.innerHTML = ic(e.dataset.icon)));
const still = params.has('still');
if (still) document.documentElement.classList.add('still');
const sm = innerWidth < 900;
// sprite strip from STRIPS[name] = [file, frames, frameW, frameH]; shown at display height h
type SpriteOptions = { fit?: string; px?: boolean; cls?: string; fd?: number; delay?: number };
const spr = (name: string, h: number, o: SpriteOptions = {}) => {
  const [f, n, w, fh] = STRIPS[name]!;
  const H = o.fit || h + 'px',
    W = o.fit ? `calc(${o.fit} * ${(w / fh).toFixed(4)})` : Math.round((w * h) / fh) + 'px';
  return `<span class="sprite${o.px ? ' px' : ''}${o.cls ? ' ' + o.cls : ''}" style="width:${W};height:${H};background:url(/factory/assets/${f}) 0 0/calc(${W} * ${n}) ${H};--fw:${W};--n:${n};--fd:${o.fd || (n > 2 ? (n / 12) * 0.9 : 0.5)}s;${o.delay ? 'animation-delay:' + o.delay + 's' : ''}"></span>`;
};
const img = (f: string, h: number, cls = '') =>
  `<img class="${cls}" src="/factory/assets/${f}" alt="" style="height:${h}px">`;

// stations along the line
const st = ['Idea', 'Mocks', 'Prototype', 'Review', 'Build', 'Publish'];
document.getElementById('stations')!.innerHTML = st
  .map(
    (s, i) =>
      `<div class="st"><b>${s}</b><span class="lamp" style="animation-delay:${i}s"></span><span class="arm"></span></div>`,
  )
  .join('');
document.getElementById('rollers')!.innerHTML = '<i></i>'.repeat(sm ? 10 : 28);
// cargo: a mixed run of 2D sprites and 3D renders, duplicated so the loop is seamless
const k = sm ? 0.8 : 1;
const items = [
  img('kk-knight.webp', 104 * k),
  img('kk-tower.webp', 132 * k),
  spr('k2-slime', 44 * k, { cls: 'hop' }),
  img('kk-skeleton.webp', 104 * k),
  img('kk-chest_gold.webp', 64 * k),
  img('px-wizard.png', 64 * k, 'px'),
  spr('k2-bee', 84 * k, { cls: 'fly' }),
  img('k2-tower.webp', 120 * k),
  spr('k2-hero-pink', 104 * k),
  img('k2-house.webp', 96 * k),
  spr('k2-hero', 84 * k),
  spr('k2-snail', 96 * k),
  img('k2-house.webp', 84 * k),
  img('px-demon.png', 64 * k, 'px'),
  spr('k2-bee', 96 * k, { cls: 'fly' }),
  img('k2-house.webp', 128 * k),
  spr('k2-hero', 104 * k),
  spr('k2-bee', 52 * k, { cls: 'fly' }),
  img('kk-chest_gold.webp', 80 * k),
  spr('k2-hero', 104 * k),
  img('k2-house.webp', 104 * k),
  img('px-knight.png', 60 * k, 'px'),
  img('kk-chest_gold.webp', 60 * k),
  spr('k2-snail', 44 * k),
  img('k2-tower.webp', 112 * k),
  spr('k2-hero-pink', 104 * k),
  img('kk-barrel_large_decorated.webp', 64 * k),
  spr('k2-hero-pink', 84 * k),
  img('k2-tower.webp', 136 * k),
  img('px-ghost.png', 60 * k, 'px'),
];
document.getElementById('cargo')!.innerHTML = items.join('') + items.join('');

// style molds
const fams: [string, string][] = [
  ['iso', 'Isometric pixel'],
  ['bit16', '3D to pixel'],
  ['lowpoly', 'Low poly'],
  ['cartoon', 'Cartoon'],
  ['sketch', 'Sketch'],
];
document.getElementById('molds')!.innerHTML = fams
  .map(([k, l], i) => `<div class="mold${i == 2 ? ' sel' : ''}"><span class="icon">${ic(k)}</span><b>${l}</b></div>`)
  .join('');

// factory floor
const roles: [string, string, string, string, string, number][] = [
  ['Visual', 'brush', '#ffbf32', 'k2-hero', '#1342 pixel finish', 4],
  ['Gameplay', 'play', '#6fd6b4', 'k2-hero-pink', '#1318 combat loop', 6],
  ['Audio', 'volume', '#74c8ed', 'k2-snail', '#1290 town voices', 5],
  ['QA', 'bug', '#f76d67', 'k2-hero', '#1331 phone playtest', 3.5],
  ['Assets', 'chest', '#ff9133', 'k2-hero', '#1340 asset intake', 7],
  ['Setting', 'map', '#d795e4', 'k2-hero-pink', '#1311 forest edge', 4.5],
  ['Game design', 'bulb', '#94d742', 'k2-hero', '#1355 decision set', 5.5],
];
const g = document.getElementById('floorgrid')!;
g.innerHTML =
  roles
    .map(
      ([n, i, c, s, t, tt], j) =>
        `<div class="ws" style="color:${c}"><div class="top"><span class="icon">${ic(i)}</span>${n}</div><div><div class="tk mono">${t}</div><div class="bar" style="margin-top:8px"><i style="--t:${tt}s;animation-delay:-${j * 0.7}s"></i></div></div>${spr(s, sm ? 80 : 120, { fd: 1.3, delay: -j * 0.17 })}</div>`,
    )
    .join('') +
  `<div class="ws mq"><div class="top"><span class="icon">${ic('versions')}</span>Merge queue</div><ol class="mono"><li>#1342<span>green</span></li><li>#1318<span>testing</span></li><li>#1290<span>queued</span></li></ol></div>`;

// Review art is awaiting a rights-cleared scene.
const arrow = `<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
for (const o of ['h', 'v']) {
  const ar = o === 'h' ? 16 / 9 : 9 / 16;
  document.getElementById('set-' + o)!.innerHTML =
    '<div class="gates">' +
    ['Sketch', 'Mock render', 'Final']
      .map(
        (label, i) =>
          (i ? arrow : '') +
          `<figure class="gate" style="--ar:${ar}"><div class="art pending-art"><span>Scene pending</span></div><footer>${label}<span class="v-no mono">placeholder</span></footer></figure>`,
      )
      .join('') +
    '</div>';
}
document.querySelectorAll<HTMLButtonElement>('.toggle button').forEach((b) =>
  b.addEventListener('click', () => {
    document
      .querySelectorAll<HTMLButtonElement>('.toggle button')
      .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    for (const o of ['h', 'v']) {
      const el = document.getElementById('set-' + o)!;
      el.hidden = o !== b.dataset.set;
      el.querySelectorAll('video').forEach((v) => (o === b.dataset.set ? v.play().catch(() => {}) : v.pause()));
    }
  }),
);
if (params.has('vert')) document.querySelector<HTMLButtonElement>('.toggle [data-set=v]')?.click();

// devices: one scene, laid out per device shape
const scene = () =>
  `<div class="scene"><span class="sun"></span><img class="mill" src="/factory/assets/k2-house.webp" alt=""><img class="bld" src="/factory/assets/k2-house.webp" alt=""><img class="twr" src="/factory/assets/k2-tower.webp" alt=""><span class="dh">${spr('k2-hero', 1, { fit: '22cqh' })}</span><span class="dm">${spr('k2-slime', 1, { fit: '22cqh', delay: -0.3 })}</span><span class="pad"></span><span class="btns"><i></i><i></i></span></div>`;
const devices: [string, boolean][] = [
  ['monitor', false],
  ['laptop2', false],
  ['tablet', true],
  ['phl', true],
  ['php', true],
];
document.getElementById('desk')!.innerHTML = devices
  .map(([c, t]) => `<div class="dev ${c}${t ? ' touch' : ''}">${scene()}</div>`)
  .join('');

// crew in the cta
document.getElementById('crew')!.innerHTML = ['k2-hero', 'k2-hero-pink', 'k2-hero', 'k2-hero-pink']
  .map((s, j) => spr(s, sm ? 96 : 150, { delay: -j * 0.2 }))
  .join('');

if (!still && 'IntersectionObserver' in window) {
  document.body.classList.add('pre');
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.12 },
  );
  document.querySelectorAll('.reveal').forEach((e) => io.observe(e));
}
