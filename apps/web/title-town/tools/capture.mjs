#!/usr/bin/env node
// superseded by gm run / gm shot / gm perf (OGM-090); kept for the town only
// Look at the prototype: stills at chosen times, a tiled timeline, or a recorded clip. Serve the prototype first
// (python3 -m http.server 8792 in apps/web/title-town). Uses the GPU through ANGLE/EGL.
//   node tools/capture.mjs stills  "<query>" <out-dir> <t...>        e.g. "cam=a" shots/ 0 30 60
//   node tools/capture.mjs timeline "<query>" <out.png> <t...>       one image, frames tiled in time order, 4 per row
//   node tools/capture.mjs record  "<query>" <out.mp4> <seconds> [fps]  H.264 960 px, phone-friendly
// Env: PORT (8792), W, H (1280x720).
import { createRequire } from 'module';
import { mkdirSync, rmSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../../') + '/');
const { chromium } = require('playwright');
const [mode, query, out, ...rest] = process.argv.slice(2), W = +(process.env.W || 1280), H = +(process.env.H || 720), PORT = process.env.PORT || 8792;
if (!mode || !out) { console.error('usage: capture.mjs stills|timeline|record "<query>" <out> ...'); process.exit(2); }
const b = await chromium.launch({ args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
p.on('pageerror', e => { console.error('pageerror', e.message); if (!ready) { console.error('page failed to load; not waiting'); process.exit(1); } });   // a syntax error would otherwise wait out the 3-minute timeout
let ready = false;
await p.goto(`http://localhost:${PORT}/index.html?capture&${query}`);
await p.waitForFunction(() => window.__ready, null, { timeout: 180000 }); ready = true;
const shot = async (t, path, type = 'png') => { await p.evaluate(t => window.__frame(t), t); await p.screenshot({ path, type, ...(type === 'jpeg' ? { quality: 92 } : {}) }); };
if (mode === 'stills') { mkdirSync(out, { recursive: true }); for (const t of rest) await shot(+t, join(out, `t${t}.png`)); }
else if (mode === 'timeline') {
  const tmp = out + '.frames'; mkdirSync(tmp, { recursive: true });
  const files = []; for (const [i, t] of rest.entries()) { const f = join(tmp, `${String(i).padStart(3, '0')}.png`); await shot(+t, f); files.push(f); }
  const cols = Math.min(4, files.length), rows = Math.ceil(files.length / cols);
  const args = files.flatMap(f => ['-i', f]), pad = cols * rows - files.length;
  const inputs = files.map((_, i) => `[${i}]`).join('') + (pad ? Array.from({ length: pad }, () => `[${files.length - 1}]`).join('') : '');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, '-filter_complex', `${inputs}xstack=inputs=${cols * rows}:layout=${Array.from({ length: cols * rows }, (_, i) => `${i % cols === 0 ? '0' : Array.from({ length: i % cols }, () => 'w0').join('+')}_${Math.floor(i / cols) === 0 ? '0' : Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+')}`).join('|')},scale=1600:-1`, out]);
  rmSync(tmp, { recursive: true, force: true });
}
else if (mode === 'record') {
  const secs = +rest[0], fps = +(rest[1] || 30), tmp = out + '.frames'; mkdirSync(tmp, { recursive: true });
  const start = +(process.env.START || 0);   // START=<seconds>: begin the clip there
  for (let i = 0; i < secs * fps; i++) await shot(start + i / fps, join(tmp, `f${String(i).padStart(5, '0')}.jpg`), 'jpeg');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', join(tmp, 'f%05d.jpg'), '-vf', 'scale=960:-2', '-c:v', 'libx264', '-profile:v', 'main', '-level:v', '4.1', '-r', String(fps), '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '27', '-movflags', '+faststart', out]);
  rmSync(tmp, { recursive: true, force: true });
}
await b.close(); console.log('wrote', out);
