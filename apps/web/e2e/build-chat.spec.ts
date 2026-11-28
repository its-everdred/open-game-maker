import { expect, test, type Page, type Route } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

const jobId = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';
const imageUrl = 'https://media.example.test/image.svg';
const clipUrl = 'https://media.example.test/clip.mp4';

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
    title: 'Add the moonlit door',
    summary: 'Add a door to the forest room.',
    scope: { included: ['door'], excluded: [] },
    tickets: [{ key: 'OGM-TEST', skills: [], dependsOn: [], acceptanceCriteria: ['The door opens.'] }],
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
  stageText: 'Building the door',
  progressPercent: 50,
};

const messages = [
  message('m_1', 'image', { text: 'First door sketch', media: media(imageUrl) }),
  message('m_2', 'image', { text: 'Moonlit door sketch', media: media(`${imageUrl}?second`) }),
  message('m_3', 'clip', {
    text: 'The door swings open',
    media: { ...media(clipUrl), poster: `${imageUrl}?poster`, duration_ms: 4_000 },
  }),
  message('m_4', 'text', { text: 'I added the moonlight.' }),
  message('m_5', 'progress', { actor: 'system', text: 'Door animation wired up' }),
  message('m_6', 'command', {
    text: 'Which door looks right?',
    command: {
      decision_id: '',
      question: 'Which door looks right?',
      options: [
        { id: 'a', label: 'Wooden', media_id: 'm_1' },
        { id: 'b', label: 'Iron', media_id: 'm_2' },
      ],
      recommend: 'a',
      status: 'open',
    },
  }),
];

test.use({ serviceWorkers: 'block' });

test('phone build dock opens the streamed chat and posts text once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthRoutes(page, { signedIn: true });
  await installBuildRoutes(page);
  await page.goto('/all?test');

  await expect(page.locator('.studio-library-volume button')).toHaveAttribute('data-building', 'true');
  await openBuildChat(page);

  const panel = page.locator('.build-chat-panel');
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.height).toBeCloseTo(page.viewportSize()!.height, 4);
  expect(
    Number.parseFloat(await panel.evaluate((element) => getComputedStyle(element).paddingBottom)),
  ).toBeGreaterThanOrEqual(12);

  await expect(page.locator('.build-chat-row.media img')).toHaveCount(2);
  const clip = page.locator('.build-chat-row.media video');
  await expect(clip).toHaveCount(1);
  await expect(clip).toHaveAttribute('poster', `${imageUrl}?poster`);
  expect(await clip.evaluate((element) => (element as HTMLVideoElement).muted)).toBe(true);
  await expect(page.getByText('Door animation wired up')).toBeVisible();
  await expect(page.getByText('Which door looks right?', { exact: true })).toBeVisible();
  await expect(page.getByText('Question 1 of 3')).toBeVisible();

  const postedText = 'Make the moonlight warmer';
  const composer = page.locator('aiur-composer');
  await composer.locator('textarea').fill(postedText);
  await composer.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(postedText, { exact: true })).toHaveCount(1);

  await expect
    .poll(() =>
      page.evaluate(
        ({ id }) => {
          type JobsApi = { dockState: string; jobs: unknown[]; messagesByJob: Record<string, unknown[]> };
          type TestWindow = Window & { __ogmHost?: { get(name: string): unknown } };
          const api = (window as TestWindow).__ogmHost?.get('jobs') as JobsApi | undefined;
          return api
            ? { dockState: api.dockState, jobs: api.jobs.length, messages: api.messagesByJob[id]?.length }
            : null;
        },
        { id: jobId },
      ),
    )
    .toEqual({ dockState: 'chat', jobs: 1, messages: 7 });

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.build-chat-landscape-list')).toBeVisible();
  await expect(page.locator('.build-chat-chat-layout')).toHaveCSS('display', 'grid');
  await expect(page.locator('.build-chat-panel')).toHaveCSS('height', '390px');
});

test('large pasted text becomes a compact attachment on phone and desktop', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize(
    testInfo.project.name === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  );
  await installAuthRoutes(page, { signedIn: true });
  await installBuildRoutes(page);
  await page.route('**/api/v1/jobs/*/chat/attachments', async (route) =>
    json(route, { id: 'a_pasted_text', kind: 'text', name: 'pasted-text.txt', mime: 'text/plain', bytes: 1_501 }, 201),
  );
  await page.goto('/all?test', { waitUntil: 'domcontentloaded' });
  await openBuildChat(page);

  const composer = page.locator('#chat-dock-slot aiur-composer');
  const textbox = composer.locator('textarea');
  const smallPasteAccepted = await textbox.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'a'.repeat(1_500));
    return element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(smallPasteAccepted).toBe(true);
  const largePaste = 'a'.repeat(1_501);
  const largePasteAccepted = await textbox.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    return element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, largePaste);
  expect(largePasteAccepted).toBe(false);
  const chip = composer.locator('.chip');
  await expect(chip.locator('span')).toHaveText('pasted-text.txt');
});

// #222: files reach the builder as attachment ids on the message; the composer only shows their names.
test('attaches files with the button and by pasting an image, then sends them with the message', async ({ page }) => {
  // Two uploads and a post on top of the dock flow, which alone takes most of the default budget on software GL.
  test.setTimeout(60_000);
  await installAuthRoutes(page, { signedIn: true });
  const uploads: { type: string; name: string }[] = [];
  const posts: unknown[] = [];
  await installBuildRoutes(page, { posts });
  await page.route('**/api/v1/jobs/*/chat/attachments', async (route) => {
    const headers = route.request().headers();
    const name = decodeURIComponent(headers['x-file-name'] ?? '');
    uploads.push({ type: headers['content-type'] ?? '', name });
    const image = (headers['content-type'] ?? '').startsWith('image/');
    await json(
      route,
      {
        // Keyed by file, not arrival: the composer uploads all attachments at once, so they can land in any order.
        id: `a_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e${name === 'pasted-door.png' ? '02' : '01'}`,
        kind: image ? 'image' : 'text',
        name,
        mime: image ? 'image/webp' : 'text/markdown',
        bytes: 9,
      },
      201,
    );
  });
  await page.goto('/all?test');
  await openBuildChat(page);

  const chooser = page.waitForEvent('filechooser');
  const aiurComposer = page.locator('#chat-dock-slot aiur-composer');
  await aiurComposer.getByRole('button', { name: 'Attach files' }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'door-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Door\nMake it creak.\n') },
    { name: 'blocked.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') },
  ]);
  const chips = aiurComposer.locator('.chip');
  await expect(chips).toHaveCount(1);
  await expect(chips.locator('span')).toHaveText(['door-notes.md']);

  const textbox = aiurComposer.locator('textarea');
  await textbox.evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'pasted-door.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(chips.locator('span')).toHaveText(['door-notes.md', 'pasted-door.png']);

  await textbox.fill('Use these for the door');
  await aiurComposer.getByRole('button', { name: 'Send' }).click();
  await expect(chips).toHaveCount(0);
  await expect
    .poll(() => posts)
    .toEqual([
      {
        text: 'Use these for the door',
        attachments: ['a_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01', 'a_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e02'],
      },
    ]);
  expect(uploads).toHaveLength(2);
  expect(uploads).toEqual(
    expect.arrayContaining([
      { type: 'text/markdown', name: 'door-notes.md' },
      { type: 'image/png', name: 'pasted-door.png' },
    ]),
  );
});

test('a broken picker leaves the chat dock mounted', async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true });
  await installBuildRoutes(page, { brokenPicker: true });
  await page.goto('/all?test');

  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.locator('.studio-library-volume button')).toBeVisible();
});

test('asking for a change with no build running starts an edit job and streams it', async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  const created: Array<Record<string, unknown>> = [];
  const editJob = {
    ...job,
    id: 'j_0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
    gameId: 'game',
    creatorId: 'u1',
    state: 'admitted',
    stage: 'queued_ogm',
    stageText: undefined,
    progressPercent: 0,
    plan: { ...job.plan, title: 'Make the door glow' },
  };
  const streamed: string[] = [];
  let jobResponses = 0;
  let admissionStarted = false;
  let postAdmissionJobRequests = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/jobs' && request.method() === 'POST') admissionStarted = true;
    if (admissionStarted && url.pathname === '/api/v1/jobs' && url.searchParams.has('gameId')) {
      postAdmissionJobRequests += 1;
    }
  });
  // Registered after installGameApi, so these win over its catch-all.
  await page.route('**/api/v1/games', (route) => json(route, { games: [{ id: 'game' }] }));
  await page.route('**/api/v1/jobs?gameId=*', async (route) => {
    await json(route, { jobs: created.length > 0 ? [editJob] : [] });
    jobResponses += 1;
  });
  await page.route('**/api/v1/jobs', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    created.push(route.request().postDataJSON() as Record<string, unknown>);
    return json(
      route,
      {
        jobId: editJob.id,
        state: 'admitted',
        reservation: editJob.reservation,
        slot: 'edit',
      },
      201,
    );
  });
  await page.route('**/api/v1/jobs/*/chat*', async (route) => {
    streamed.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
  });
  await page.route('**/api/v1/budget/status', (route) => json(route, { unitLabel: 'coins' }));
  await page.route('**/api/v1/voice/token', (route) => json(route, { error: 'unavailable' }, 503));

  await page.clock.install();
  await page.goto('/g/game?test');
  await expect.poll(() => jobResponses).toBeGreaterThan(0);
  // Waiting for the empty jobs response lets the live game frame start moving the menu controls; this test targets
  // refresh rather than their registration timing.
  // Play mode carries no agent context (#1326): asking for a change starts from the editor's menu.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Ask for a change' }).first().click();
  await expect(page.getByRole('heading', { name: 'Goblin Cellar' })).toBeVisible();

  // The clock jump triggers a poll; finish it before admission, then keep polling frozen.
  const pendingPoll = page.waitForResponse((response) => response.url().includes('/api/v1/jobs?gameId='));
  await page.clock.pauseAt(Date.now() + 60_000);
  await pendingPoll;
  const composer = page.locator('#chat-dock-slot aiur-composer');
  await composer.locator('textarea').fill('Make the door glow');
  await composer.getByRole('button', { name: 'Send' }).click({ force: true });

  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({ gameId: 'game', branchId: 'main', kind: 'feature', start: 'now' });
  await expect.poll(() => streamed).toContain(`/api/v1/jobs/${editJob.id}/chat`);
  await expect.poll(() => postAdmissionJobRequests).toBeGreaterThan(0);
  await page.clock.resume();
  await expect(page.getByRole('heading', { name: 'Make the door glow' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  // The editor's menu lists the job with its stage (#1326).
  await expect(
    page
      .getByRole('dialog', { name: 'Paused' })
      .getByRole('region', { name: 'Work' })
      .getByText('Waiting for a free slot'),
  ).toBeVisible({ timeout: 2_000 });
});

// #1223: each composer failure names its cause on the phone and reaches the API log.
test('names a blocked microphone and a refused voice token at 390x844', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await installAuthRoutes(page, { signedIn: true });
  await installBuildRoutes(page);
  const reports: unknown[] = [];
  await page.route('**/api/v1/voice/token', (route) => json(route, { error: 'forbidden' }, 403));
  await page.route('**/api/v1/voice/dictation-token', (route) => json(route, { error: 'forbidden' }, 403));
  await page.route('**/api/v1/voice/client-error', async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto('/all?test');
  await openBuildChat(page);

  const composer = page.locator('#chat-dock-slot aiur-composer');
  const alert = page.locator('.build-chat-panel [role="alert"]');
  await composer.getByRole('button', { name: 'Dictate' }).click();
  await composer.getByRole('button', { name: 'Stop dictation' }).click();
  await expect(alert).toHaveText(/^Microphone blocked\..*Safari.*\(dictation: mic_denied\)$/);
  await page.screenshot({ path: testInfo.outputPath('mic-denied.png') });
  await expect.poll(() => reports).toContainEqual(expect.objectContaining({ action: 'dictation', code: 'mic_denied' }));

  await composer.getByRole('button', { name: 'Dictate' }).click();
  await composer.getByRole('button', { name: 'Switch to voice conversation' }).click();
  await expect(alert).toHaveText('Voice unavailable. (voice: api_403)');
  await page.screenshot({ path: testInfo.outputPath('token-403.png') });
  await expect.poll(() => reports).toContainEqual(expect.objectContaining({ action: 'voice', code: 'api_403' }));
});

test('names a message the build chat could not send at 390x844', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthRoutes(page, { signedIn: true });
  await installBuildRoutes(page);
  const reports: unknown[] = [];
  await page.route('**/api/v1/jobs/*/chat*', (route) =>
    route.request().method() === 'POST' ? json(route, { error: 'internal' }, 500) : route.fallback(),
  );
  await page.route('**/api/v1/voice/client-error', async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto('/all?test');
  await openBuildChat(page);

  const textarea = page.locator('#chat-dock-slot aiur-composer textarea');
  await textarea.fill('Make the door glow');
  await textarea.press('Enter');
  await expect(page.locator('.build-chat-panel [role="alert"]')).toHaveText('Message not sent. (send: api_500)');
  await page.screenshot({ path: testInfo.outputPath('send-500.png') });
  await expect.poll(() => reports).toContainEqual(expect.objectContaining({ action: 'send', code: 'api_500' }));
});

async function installBuildRoutes(page: Page, options: { brokenPicker?: boolean; posts?: unknown[] } = {}) {
  await page.route('**/api/v1/games', (route) =>
    json(route, {
      games: options.brokenPicker
        ? [
            {
              id: job.gameId,
              title: { broken: true },
              familyId: job.familyId,
              ownerId: job.creatorId,
              repo: null,
              createdAt: job.createdAt,
            },
          ]
        : [{ id: job.gameId, title: 'Moonlit Door' }],
    }),
  );
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
      const body = route.request().postDataJSON() as { text: string };
      options.posts?.push(body);
      return json(route, message('m_7', 'text', { actor: 'creator', text: body.text, at: new Date().toISOString() }));
    }
    const body = messages
      .map((value, index) => `id: ${index + 1}\nevent: message\ndata: ${JSON.stringify(value)}\n`)
      .join('\n');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `${body}\n` });
  });
  await page.route('**/media.example.test/**', async (route) => {
    if (route.request().url().includes('.mp4')) {
      return route.fulfill({ status: 200, contentType: 'video/mp4', body: '' });
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#7b4f9d"/></svg>',
    });
  });
}

async function openBuildChat(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        type TestWindow = Window & { __ogmHost?: { get(name: string): unknown } };
        return Boolean((window as TestWindow).__ogmHost?.get('jobs'));
      }),
    )
    .toBe(true);
  await page.evaluate((id) => {
    type JobsApi = { open(jobId: string): void };
    type TestWindow = Window & { __ogmHost?: { get(name: string): unknown } };
    ((window as TestWindow).__ogmHost?.get('jobs') as JobsApi).open(id);
  }, jobId);
}

function message(id: string, kind: string, overrides: Record<string, unknown>) {
  return {
    id,
    job_id: jobId,
    at: '2026-11-01T09:12:30Z',
    actor: 'agent',
    kind,
    ...overrides,
  };
}

function media(url: string) {
  return { url, width: 640, height: 360 };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('build composer keeps voice controls at the right through dictation and live voice', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The review stills use the phone portrait layout.');
  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthRoutes(page, { signedIn: true });
  await installBuildRoutes(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const audio = new AudioContext();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const destination = audio.createMediaStreamDestination();
        gain.gain.value = 0.45;
        const modulation = audio.createOscillator();
        const modulationDepth = audio.createGain();
        modulation.frequency.value = 0.8;
        modulationDepth.gain.value = 0.2;
        modulation.connect(modulationDepth).connect(gain.gain);
        modulation.start();
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        await audio.resume();
        return destination.stream;
      },
    });
  });
  await page.route('**/api/v1/voice/dictation-token', (route) =>
    json(route, { token: 'dictation-token', url: 'wss://dictation.example.test/session' }),
  );
  await page.route('**/api/v1/voice/token', (route) =>
    json(route, { token: 'voice-token', url: 'wss://voice.example.test/session' }),
  );
  await page.routeWebSocket('wss://dictation.example.test/**', (socket) => {
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { type: string };
      if (frame.type === 'audio')
        socket.send(JSON.stringify({ v: 1, type: 'transcript', kind: 'partial', text: 'Make the moonlight warmer' }));
      if (frame.type === 'commit')
        socket.send(JSON.stringify({ v: 1, type: 'transcript', kind: 'final', text: 'Make the moonlight warmer' }));
    });
  });
  let receivedVoiceText = '';
  await page.routeWebSocket('wss://voice.example.test/**', (socket) => {
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { type: string; text?: string };
      if (frame.type === 'start')
        socket.send(JSON.stringify({ v: 1, type: 'state', state: 'ready', capabilities: { text: true } }));
      if (frame.type === 'text') {
        receivedVoiceText = frame.text ?? '';
        socket.send(JSON.stringify({ v: 1, type: 'transcript', kind: 'final', text: receivedVoiceText }));
        socket.send(
          JSON.stringify({ v: 1, type: 'agent_text', turn_id: 'turn-1', text: 'I started the run.', final: true }),
        );
      }
    });
  });
  await page.context().grantPermissions(['microphone']);
  await page.goto('/all?test');
  await openBuildChat(page);
  const composer = page.locator('aiur-composer');
  const mic = composer.locator('[part="mic"]');
  const send = composer.locator('[part="send"]');
  const input = composer.locator('[part="input"]');

  const idleMic = await mic.boundingBox();
  const idleSend = await send.boundingBox();
  expect(idleMic).not.toBeNull();
  expect(idleSend).not.toBeNull();
  expect(idleMic!.x).toBeLessThan(idleSend!.x);
  expect(idleMic!.width).toBe(40);
  expect(idleSend!.width).toBe(40);
  expect(
    await composer.evaluate(
      (node) => getComputedStyle((node as HTMLElement).shadowRoot!.querySelector('[part="card"]')!).borderRadius,
    ),
  ).toBe('28px');
  await expect(mic).toHaveCSS('border-width', '0px');
  await expect(mic).toHaveCSS('box-shadow', 'none');
  await page.screenshot({ path: 'e2e/screenshots/1087/composer-idle.png' });

  await mic.click();
  await expect(composer).toHaveAttribute('data-recording', '');
  await expect(mic).toBeVisible();
  await expect(mic).toHaveAttribute('aria-label', 'Mute microphone');
  await expect
    .poll(() => mic.evaluate((button) => getComputedStyle(button).backgroundColor))
    .toBe('rgb(116, 200, 237)');
  await expect(input).toHaveValue('Make the moonlight warmer');
  await expect(composer.locator('[part="waveform"]')).toBeVisible();
  await expect(composer.locator('[part="voice"]')).toBeVisible();
  await expect
    .poll(() =>
      composer.evaluate((node) => {
        const heights = Array.from(node.shadowRoot!.querySelectorAll<HTMLElement>('[part="waveform"] i')).map(
          (bar) => bar.getBoundingClientRect().height,
        );
        return Math.max(...heights);
      }),
    )
    .toBeGreaterThan(2);
  await expect
    .poll(() =>
      composer.evaluate((node) => {
        const heights = Array.from(node.shadowRoot!.querySelectorAll<HTMLElement>('[part="waveform"] i')).map(
          (bar) => bar.getBoundingClientRect().height,
        );
        return Math.max(...heights) - Math.min(...heights);
      }),
    )
    .toBeGreaterThan(1);
  expect(await input.inputValue()).toBe('Make the moonlight warmer');
  const recordingMic = await mic.boundingBox();
  const recordingSend = await send.boundingBox();
  const inputBox = await input.boundingBox();
  expect(Math.abs(recordingMic!.x - idleMic!.x)).toBeLessThan(1);
  expect(Math.abs(recordingSend!.x - idleSend!.x)).toBeLessThan(1);
  expect(inputBox!.y + inputBox!.height).toBeLessThan((await composer.locator('[part="voice"]').boundingBox())!.y);
  await page.screenshot({ path: 'e2e/screenshots/1087/composer-dictating.png', animations: 'disabled' });

  await mic.click();
  await expect(mic).toHaveAttribute('aria-label', 'Unmute microphone');
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => mic.evaluate((button) => getComputedStyle(button).backgroundColor))
    .toBe('rgb(116, 200, 237)');
  await expect(mic).toHaveCSS('opacity', '0.58');
  await expect
    .poll(() =>
      composer.evaluate((node) =>
        Math.max(
          ...Array.from(node.shadowRoot!.querySelectorAll<HTMLElement>('[part="waveform"] i')).map(
            (bar) => bar.getBoundingClientRect().height,
          ),
        ),
      ),
    )
    .toBeLessThanOrEqual(3);
  await page.screenshot({ path: 'e2e/screenshots/1087/composer-dictating-muted.png', animations: 'disabled' });
  await mic.click();
  await expect(mic).toHaveAttribute('aria-label', 'Mute microphone');
  await composer.locator('[part="voice"]').click();
  await expect(composer).toHaveAttribute('data-voice-live', '');
  await expect(composer.locator('[part="voice"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(composer.locator('[part="waveform"]')).toBeVisible();
  await expect
    .poll(() =>
      composer.evaluate((node) =>
        Math.max(
          ...Array.from(node.shadowRoot!.querySelectorAll<HTMLElement>('[part="waveform"] i')).map(
            (bar) => bar.getBoundingClientRect().height,
          ),
        ),
      ),
    )
    .toBeGreaterThan(2);
  await expect
    .poll(() =>
      composer.evaluate((node) => {
        const heights = Array.from(node.shadowRoot!.querySelectorAll<HTMLElement>('[part="waveform"] i')).map(
          (bar) => bar.getBoundingClientRect().height,
        );
        return Math.max(...heights) - Math.min(...heights);
      }),
    )
    .toBeGreaterThan(1);
  await expect(mic).toBeVisible();
  await expect(mic).toHaveAttribute('aria-label', 'Mute microphone');
  await expect.poll(() => receivedVoiceText).toBe('Make the moonlight warmer');
  const liveConversation = page.getByRole('log', { name: 'Live voice conversation' });
  await expect(liveConversation.getByText('Make the moonlight warmer')).toBeVisible();
  await expect(liveConversation.getByText('I started the run.')).toBeVisible();
  const userBubble = liveConversation.locator('[aria-label="you"]');
  const agentBubble = liveConversation.locator('[aria-label="agent"]');
  await expect(userBubble).toHaveClass(/creator/);
  await expect(agentBubble).toHaveClass(/agent/);
  await expect(userBubble).toHaveCSS(
    'background-color',
    await agentBubble.evaluate((node) => getComputedStyle(node).backgroundColor),
  );
  const userBubbleBox = await userBubble.boundingBox();
  const agentBubbleBox = await agentBubble.boundingBox();
  expect(userBubbleBox!.x).toBeGreaterThan(agentBubbleBox!.x);
  expect(userBubbleBox!.y).toBeLessThan(agentBubbleBox!.y);
  await page.screenshot({ path: 'e2e/screenshots/1087/composer-two-way-voice.png', animations: 'disabled' });
  await composer.locator('[part="voice"]').click();
});
