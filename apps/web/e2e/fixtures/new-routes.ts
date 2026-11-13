import { readFileSync } from 'node:fs';

import type { Page, Route } from '@playwright/test';

const catalog = JSON.parse(readFileSync(new URL('./style-families.json', import.meta.url), 'utf8')) as unknown;
const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';
const sessionId = 's_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';
const scopeJobId = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';

export type NewRouteState = {
  admissions: Array<Record<string, unknown>>;
  scopeMessages: string[];
  scopeRequests: Array<Record<string, unknown>>;
};

export async function installNewRoutes(page: Page): Promise<NewRouteState> {
  const state: NewRouteState = { admissions: [], scopeMessages: [], scopeRequests: [] };
  let scopeAgreed = false;

  await page.route('**/api/catalog/style-families', (route) => json(route, catalog));
  // The creation flow asks for the Sound step's tiles on every screen. No montage is rendered in this fixture, so the
  // API offers none and the flow skips the step; answer the request so it never falls through to the dev proxy.
  await page.route('**/api/catalog/audio-styles', (route) => json(route, { families: [] }));
  await page.route('**/e2e/*', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('.mp4'))
      return route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from([0, 0, 0, 0]) });
    if (path.endsWith('.gif'))
      return route.fulfill({
        status: 200,
        contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
      });
    return route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#458588"/></svg>',
    });
  });
  await page.route('**/api/v1/games', async (route) => {
    if (route.request().method() === 'POST') return json(route, { id: gameId }, 201);
    return json(route, { games: [] });
  });
  await page.route('**/api/v1/games/*/scope/sessions', (route) => {
    state.scopeRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    return json(route, { sessionId, jobId: scopeJobId }, 201);
  });
  await page.route(/\/api\/v1\/games\/[^/]+\/scope\/sessions\/[^/?]+$/, (route) =>
    json(route, {
      sessionId,
      chatJobId: scopeJobId,
      status: scopeAgreed ? 'agreed' : 'open',
      choices: {
        genre: 'Adventure',
        vibe: 'Moonlit',
        family: 'smallscaleint',
        world: 'Sky islands',
        players: 'single',
        pov: 'iso',
      },
      ...(scopeAgreed ? { scope: agreedScope() } : {}),
    }),
  );
  await page.route('**/api/v1/jobs/*/chat*', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { text: string };
      state.scopeMessages.push(body.text);
      scopeAgreed = true;
      return json(route, message('m_creator', 'creator', body.text, new Date().toISOString()), 201);
    }
    const event = `id: 1\nevent: message\ndata: ${JSON.stringify(
      message('m_builder', 'agent', 'Three small islands will make a good first version.'),
    )}\n\n`;
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: event });
  });
  await page.route('**/api/v1/jobs', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.admissions.push(body);
    if (state.admissions.length === 1) {
      return json(
        route,
        {
          error: 'allowance_exceeded',
          remainingMicroUsd: 1_200_000,
          resetsAt: '2026-11-02T07:00:00.000Z',
          offers: ['queue'],
        },
        402,
      );
    }
    return json(
      route,
      {
        jobId: 'j_new',
        state: 'queued',
        reservation: { amountMicroUsd: 3_000_000, sizeClass: 'medium', confidence: 'low' },
        slot: 'new_game',
        position: 1,
      },
      202,
    );
  });
  await page.route('**/api/v1/jobs?gameId=*', (route) => json(route, { jobs: [] }));
  await page.route('**/api/v1/budget/status', (route) =>
    json(route, {
      remainingMicroUsd: 1_200_000,
      remainingPercent: 40,
      unitLabel: 'coins',
      resetsAt: '2026-11-02T07:00:00.000Z',
      freeSlots: { new_game: 1, edit: 1 },
      queued: [],
    }),
  );
  await page.route('**/api/v1/voice/token', (route) => json(route, { error: 'unavailable' }, 503));
  await page.route('**/api/v1/notifications/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' }),
  );
  return state;
}

function agreedScope() {
  return {
    session_id: sessionId,
    title: 'Moonlit Delivery',
    summary: 'Deliver bread between three floating islands.',
    scope: { included: ['three islands'], excluded: ['online multiplayer'] },
    tickets: [
      {
        key: 'game',
        title: 'Build the game',
        skills: [],
        dependsOn: [],
        acceptanceCriteria: ['A delivery is playable.'],
      },
    ],
    complexity: 2,
    open_questions: [],
    ideas: [],
  };
}

function message(id: string, actor: 'creator' | 'agent', text: string, at = '2026-11-01T09:12:30.000Z') {
  return { id, job_id: scopeJobId, at, actor, kind: 'text', text };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
