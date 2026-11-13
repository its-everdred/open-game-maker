import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

type GamesFixture = {
  games: unknown[];
  jobs: unknown[];
  branches: Record<string, unknown[]>;
};

const fixture = JSON.parse(readFileSync(new URL('./games.json', import.meta.url), 'utf8')) as GamesFixture;
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function mockGamesRoutes(page: Page): Promise<void> {
  await page.route('**/api/v1/notifications/stream', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' }),
  );
  await page.route('**/api/v1/games', (route) => route.fulfill({ json: { games: gamesForPage(page) } }));
  await page.route('**/api/v1/jobs?state=active', (route) => route.fulfill({ json: { jobs: fixture.jobs } }));
  // The game spotlight's Commands inbox (M3) polls this route; an empty inbox keeps the prototype comparison stable.
  await page.route('**/api/v1/games/*/commands', (route) => route.fulfill({ json: { commands: [] } }));
  await page.route('**/api/v1/games/*/workers', (route) => route.fulfill({ json: { workers: [] } }));
  await page.route('**/api/v1/games/*/branches', (route) => {
    const gameId = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const branches = fixture.branches[gameId];
    return branches
      ? route.fulfill({ json: { branches } })
      : route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.route('https://example.test/cover.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: pixel }),
  );
}

function gamesForPage(page: Page): unknown[] {
  const requested = new URL(page.url()).searchParams.get('games');
  if (requested === null) return fixture.games;
  const count = Number.parseInt(requested, 10);
  if (!Number.isFinite(count) || count <= 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const source = fixture.games[index] ?? fixture.games.at(-1);
    if (index < fixture.games.length || !source || typeof source !== 'object') return source;
    return {
      ...source,
      id: `g_${index + 1}`,
      title: `Game ${index + 1}`,
      updatedAt: `2026-10-${String(Math.max(1, 24 - index)).padStart(2, '0')}T00:00:00Z`,
    };
  });
}
