#!/usr/bin/env node
// Records the splash page's three clips from the real web app (apps/web) on a phone viewport, with the API mocked by the
// app's own e2e fixtures, and writes public/captures/<name>.mp4 and .webp (the poster). Operator-run; needs ffmpeg.
// Builds apps/web and templates/game-2d first. Re-run after a real game exists to replace the play clip.
//   node apps/site/tools/capture.mjs [creation|build|play ...]
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WEB = join(ROOT, 'apps/web');
const TEMPLATE = join(ROOT, 'templates/game-2d/dist');
const OUT = fileURLToPath(new URL('../public/captures/', import.meta.url));
const APP_PORT = 43225;
const GAMES_PORT = 10225;
const APP = `http://127.0.0.1:${APP_PORT}`;
const PHONE = { width: 390, height: 844 };

const { chromium } = createRequire(`${WEB}/`)('playwright');
const { installAuthRoutes } = await import(join(WEB, 'e2e/fixtures/auth-routes.ts'));
const { installNewRoutes } = await import(join(WEB, 'e2e/fixtures/new-routes.ts'));
const { installGameApi } = await import(join(WEB, 'e2e/support/mock-game-api.ts'));

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sh = (command, args, env = {}) =>
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });

async function tap(page, name) {
  const button = page.getByRole('button', { name }).first();
  await button.waitFor({ state: 'visible' });
  await pause(450);
  /* the bug-report button can sit over a tap target on a phone; the e2e specs click through the DOM the same way */
  await button.evaluate((element) => element.click());
  /* let a step's exit motion finish so the next lookup finds the new step's buttons */
  if (name === 'Next') await pause(900);
}

// The creation chat: pick genre, vibe, art family, world, players and view, then talk to the scope builder.
async function creation(page, ready) {
  await installAuthRoutes(page, { signedIn: true, github: 'kim' });
  await installNewRoutes(page);
  await page.goto(`${APP}/new?step=genre`);
  await page.getByRole('button', { name: 'Adventure' }).waitFor();
  ready();
  await tap(page, 'Adventure');
  await tap(page, 'Next');
  await tap(page, 'Other');
  await tap(page, 'Type it');
  await page.getByRole('textbox', { name: 'Your own vibe' }).pressSequentially('Moonlit', { delay: 90 });
  await tap(page, 'Add');
  await tap(page, 'Next');
  for (const pick of [/SmallScaleInt/, 'Next', 'Sky islands', 'Next', 'Solo', 'Next', 'Fixed', 'Next']) {
    await tap(page, pick);
  }
  await page.getByText('Three small islands will make a good first version.').waitFor();
  await pause(900);
  await page
    .getByRole('textbox', { name: 'Message the builder' })
    .pressSequentially('Keep the first version small.', { delay: 60 });
  await tap(page, 'Send');
  await page.getByRole('button', { name: 'Finish' }).waitFor();
  await pause(1500);
}

const jobId = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';
const job = {
  id: jobId,
  gameId: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  branchId: 'main',
  familyId: 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  creatorId: 'u1',
  kind: 'feature',
  complexity: 3,
  state: 'running',
  pausedReason: null,
  start: 'now',
  startAt: null,
  slot: 'edit',
  plan: {
    title: 'Add the moonlit gate',
    summary: 'Add a gate to the castle wall.',
    scope: { included: ['gate'], excluded: [] },
    tickets: [{ key: 'OGM-GATE', skills: [], dependsOn: [], acceptanceCriteria: ['The gate opens.'] }],
  },
  reservation: { amountMicroUsd: 4_000_000, sizeClass: 'medium', confidence: 'low' },
  hardCapMicroUsd: 4_000_000,
  usageMicroUsd: 1_500_000,
  aiurRepo: null,
  aiurIssueNumber: 57,
  aiurSpendCapMicroUsd: null,
  idempotencyKey: null,
  createdAt: '2026-11-01T09:00:00Z',
  updatedAt: '2026-11-01T09:01:00Z',
  terminalAt: null,
  stage: 'building',
  stageText: 'Building the gate',
  progressPercent: 50,
};
const still = `${APP}/capture-media/town.webp`;
const message = (id, kind, fields) => ({
  id,
  job_id: jobId,
  at: '2026-11-01T09:12:30Z',
  actor: 'agent',
  kind,
  ...fields,
});
const media = (url) => ({ url, width: 1000, height: 1010 });
const chat = [
  message('m_1', 'text', { text: 'Starting on the gate in the castle wall.' }),
  message('m_2', 'image', { text: 'Gate sketch', media: media(`${still}?a`) }),
  message('m_3', 'progress', { actor: 'system', text: 'Gate model placed' }),
  message('m_4', 'image', { text: 'Moonlit gate', media: media(`${still}?b`) }),
  message('m_5', 'command', {
    text: 'Which gate looks right?',
    command: {
      decision_id: '',
      question: 'Which gate looks right?',
      options: [
        { id: 'a', label: 'Wooden', media_id: 'm_2' },
        { id: 'b', label: 'Iron', media_id: 'm_4' },
      ],
      recommend: 'a',
      status: 'open',
    },
  }),
];

// The build chat dock while a build runs: open the running build and send the builder a message.
async function build(page, ready) {
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await installAuthRoutes(page, { signedIn: true });
  await page.route('**/api/v1/games', (route) => json(route, { games: [{ id: job.gameId }] }));
  await page.route('**/api/v1/jobs?gameId=*', (route) => json(route, { jobs: [job] }));
  await page.route('**/api/v1/jobs?state=active', (route) => json(route, { jobs: [] }));
  await page.route('**/api/v1/budget/status', (route) => json(route, { unitLabel: 'coins' }));
  await page.route('**/api/v1/voice/token', (route) => json(route, { error: 'unavailable' }, 503));
  await page.route('**/api/v1/notifications/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' }),
  );
  await page.route('**/api/v1/jobs/*/commands/budget', (route) => json(route, { used: 1, max: 3 }));
  await page.route('**/api/v1/jobs/*/chat*', async (route) => {
    if (route.request().method() === 'POST') {
      const { text } = route.request().postDataJSON();
      return json(route, message('m_6', 'text', { actor: 'creator', text, at: new Date().toISOString() }));
    }
    const body = chat.map((value, i) => `id: ${i + 1}\nevent: message\ndata: ${JSON.stringify(value)}\n`).join('\n');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `${body}\n` });
  });
  await page.route('**/capture-media/**', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/webp',
      body: await readFile(join(ROOT, 'apps/site/public/hero/poster-portrait.webp')),
    }),
  );
  await page.goto(`${APP}/games`);
  await page.getByRole('button', { name: /1 build running/ }).waitFor();
  ready();
  await tap(page, /1 build running/);
  await tap(page, /Show each build/);
  await tap(page, /Add the moonlit gate/);
  await page.getByText('Which gate looks right?', { exact: true }).waitFor();
  await pause(1200);
  /* typing key by key lags under recording here; fill the message instead */
  await page.getByRole('textbox', { name: 'Message the builder' }).fill('Make the moonlight warmer');
  await tap(page, 'Send');
  await pause(2000);
}

// A phone playing a game in the app's game screen (the 2D template until a real game is built).
async function play(page, ready) {
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await page.goto(`${APP}/g/game`);
  const canvas = page.frameLocator('iframe').locator('canvas');
  await canvas.waitFor({ timeout: 20_000 });
  ready();
  await pause(1500);
  /* keys go to the focused document: focus the game frame first */
  await canvas.click();
  for (const [key, ms] of [
    ['ArrowRight', 1400],
    ['Space', 300],
    ['ArrowRight', 900],
    ['ArrowLeft', 700],
    ['Space', 300],
  ]) {
    await page.keyboard.down(key);
    await pause(ms);
    await page.keyboard.up(key);
  }
  await pause(1200);
}

const SCENES = {
  /* poster: the second the WebP poster is taken from (default: a second before the end); the creation clip ends on chat
     bubbles still streaming in, so its poster is the genre grid */
  creation: { run: creation, viewport: PHONE, poster: 1 },
  build: { run: build, viewport: PHONE },
  play: { run: play, viewport: { width: 844, height: 390 } },
};

function gamesServer() {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.json': 'application/json',
  };
  return createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname;
    const file = /^\/g\/[^/]+\/[^/]+\/index\.html$/.test(path) ? 'index.html' : path.slice(1);
    try {
      const body = await readFile(join(TEMPLATE, file));
      response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(SCENES);
for (const name of names)
  if (!SCENES[name]) throw new Error(`unknown scene ${name}; one of ${Object.keys(SCENES).join(', ')}`);

sh('pnpm', ['--filter', '@ogm/web', 'build'], { VITE_GAMES_ORIGIN: `http://127.0.0.1:${GAMES_PORT}` });
if (names.includes('play')) sh('pnpm', ['--filter', '@gm/template-game-2d', 'build']);
/* a server left on the port (an earlier run that died) would answer the readiness check with a stale build */
if (
  await fetch(APP).then(
    () => true,
    () => false,
  )
)
  throw new Error(`port ${APP_PORT} is already serving; stop it first`);
const preview = spawn(
  'pnpm',
  ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(APP_PORT), '--strictPort'],
  {
    cwd: WEB,
    stdio: 'ignore',
    detached: true,
  },
);
let previewExit = null;
preview.on('exit', (code) => (previewExit = code));
const games = gamesServer().listen(GAMES_PORT, '127.0.0.1');
const work = await mkdtemp(join(tmpdir(), 'ogm-capture-'));
let browser;
try {
  browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
  let ready = false;
  for (let i = 0; i < 60 && !ready && previewExit === null; i++) {
    ready = await fetch(APP).then(
      (r) => r.ok,
      () => false,
    );
    if (!ready) await pause(500);
  }
  if (!ready) throw new Error(`vite preview did not start on ${APP} (exit ${previewExit})`);
  /* every clip and poster is written to the work dir and copied into public/captures only once all scenes succeed,
     so a failed run never leaves a new clip beside an old poster */
  const written = [];
  for (const name of names) {
    const { run, viewport, poster } = SCENES[name];
    const dir = join(work, name);
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
      /* Playwright records CSS pixels and pads a larger size rather than scaling */
      recordVideo: { dir, size: viewport },
    });
    const page = await context.newPage();
    const openedAt = Date.now();
    let readyAt = openedAt;
    await run(page, () => (readyAt = Date.now())).catch(async (error) => {
      const shot = join(tmpdir(), `ogm-capture-${name}-failed.png`);
      await page.screenshot({ path: shot });
      console.error(`failed scene screenshot: ${shot}`);
      throw error;
    });
    await context.close();
    const [webm] = (await readdir(dir)).filter((file) => file.endsWith('.webm'));
    const video = join(work, `${name}.mp4`);
    // start each clip where its scene is ready, not on the blank page while the app boots
    const start = Math.max(0, (readyAt - openedAt) / 1000 - 0.3).toFixed(2);
    sh('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-ss',
      start,
      '-i',
      join(dir, webm),
      '-an',
      '-c:v',
      'libx264',
      '-crf',
      '30',
      '-preset',
      'slow',
      '-pix_fmt',
      'yuv420p',
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-movflags',
      '+faststart',
      video,
    ]);
    const seconds = Number(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).toString(),
    );
    sh('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(poster ?? Math.max(0, seconds - 1)),
      '-i',
      video,
      '-frames:v',
      '1',
      '-c:v',
      'libwebp',
      '-quality',
      '70',
      join(work, `${name}.webp`),
    ]);
    written.push(`${name}.mp4`, `${name}.webp`);
    console.log(`recorded ${name} (${seconds.toFixed(1)} s)`);
  }
  await mkdir(OUT, { recursive: true });
  for (const file of written) await copyFile(join(work, file), join(OUT, file));
  console.log(`wrote public/captures/${written.join(', ')}`);
} finally {
  await browser?.close();
  games.close();
  if (previewExit === null) process.kill(-preview.pid);
  await rm(work, { recursive: true, force: true });
}
