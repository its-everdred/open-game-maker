type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;
type Page = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['newPage']>>;

// Distinct, deliberately artificial messages are also canaries for the GitHub privacy check.
export const QA_TURNS = [
  'Make a small game about exploring a quiet forest, finding a hidden lantern and helping an owl. Recommend one scope. qa-private-canary-one',
  'I agree to your recommended scope. Please finish the scope so we can build it. qa-private-canary-two',
] as const;

export type CreatedGame = { id: string; ok: boolean; status: number };

/** Exercise the actual creator UI; the caller owns recording, verification and cleanup. */
export async function newGameSteps(
  page: Page,
  origin: string,
  still: (name: string) => Promise<void>,
  created: (game: CreatedGame) => void | Promise<void>,
): Promise<{ gameId: string; requestId: string }> {
  const timeout = { timeout: 60_000 };
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const heading = (name: string) => page.getByRole('heading', { name, exact: true });
  async function select(name: string, next: string) {
    await button(name).click(timeout);
    await button('Next').scrollIntoViewIfNeeded(timeout);
    await button('Next').click(timeout);
    await heading(next).waitFor(timeout);
  }
  await page.goto(`${origin}/all`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await button('New game').click(timeout);
  await heading('Genre').waitFor(timeout);
  await still('genre');
  await select('Adventure', 'Vibe');
  await still('vibe');
  await select('Cozy', 'Art');
  await still('art');
  await button('Pixel art').click(timeout);
  await button('Kenney 1-Bit').waitFor(timeout);
  await still('style-sets');
  await button('Kenney 1-Bit').click(timeout);
  await button('Select Kenney 1-Bit').waitFor(timeout);
  await still('style-detail');
  await button('Select Kenney 1-Bit').click(timeout);
  await button('Next').scrollIntoViewIfNeeded(timeout);
  await button('Next').click(timeout);
  await heading('World').waitFor(timeout);
  await still('world');
  await select('Forest', 'Players');
  await still('players');
  await button('Solo').click(timeout);
  await button('Next').scrollIntoViewIfNeeded(timeout);
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/games' && response.request().method() === 'POST',
    timeout,
  );
  const [response] = await Promise.all([responsePromise, button('Next').click(timeout)]);
  const body = (await response.json()) as { id?: unknown; details?: { gameId?: unknown } };
  const id = response.ok() ? body.id : body.details?.gameId;
  if (typeof id !== 'string') throw new Error(`game creation returned ${response.status()} without a game ID`);
  await created({ id, ok: response.ok(), status: response.status() });
  await heading('Talk it through').waitFor(timeout);
  await still('talk');
  if (!response.ok()) throw new Error(`game creation returned ${response.status()}`);
  const composer = page.locator('.build-chat-composer textarea');
  const builder = page.locator('[aria-label="Builder"] .caption .line');
  for (const turn of QA_TURNS) {
    const before = await builder.count();
    await composer.fill(turn, timeout);
    await button('Send').click(timeout);
    await page.waitForFunction(
      (count) => document.querySelectorAll('[aria-label="Builder"] .caption .line').length > count,
      before,
      timeout,
    );
  }
  await still('conversation');
  const finish = button('Finish');
  await page.waitForFunction(
    () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some((item) => item.textContent?.trim() === 'Finish' && !item.disabled);
    },
    undefined,
    { timeout: 180_000 },
  );
  const captured: { status?: number; jobId?: unknown } = {};
  const pattern = '**/api/v1/jobs';
  const handler: Parameters<Page['route']>[1] = async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const response = await route.fetch();
    const job = (await response.json().catch(() => ({}))) as { jobId?: unknown };
    captured.status = response.status();
    captured.jobId = job.jobId;
    await route.fulfill({ response });
  };
  await page.route(pattern, handler);
  try {
    const jobResponse = page.waitForResponse(
      (item) => new URL(item.url()).pathname === '/api/v1/jobs' && item.request().method() === 'POST',
      timeout,
    );
    await Promise.all([jobResponse, finish.click(timeout)]);
  } finally {
    await page.unroute(pattern, handler);
  }
  if (!captured.status || captured.status < 200 || captured.status >= 300)
    throw new Error(`Finish returned ${captured.status ?? 'no response'}`);
  if (typeof captured.jobId !== 'string') throw new Error('Finish returned no request ID');
  await page.waitForURL((url) => url.pathname === '/all' && url.searchParams.get('spotlight') === id, timeout);
  await still('library');
  return { gameId: id, requestId: captured.jobId };
}
