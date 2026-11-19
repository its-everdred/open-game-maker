import type { NewGameQaApi } from './qa-new-game-api.js';
import { parentFailure, type NewGameParent } from './qa-new-game-checks.js';
import { QA_TURNS } from './qa-new-game-steps.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;
type Page = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['newPage']>>;

/** Verify the live library and the one filed request without printing its private context. */
export async function verifyNewGame(
  page: Page,
  gameId: string,
  requestId: string,
  repo: string,
  api: Pick<NewGameQaApi, 'report' | 'context'>,
  parents: (repo: string, id: string) => Promise<NewGameParent[]>,
): Promise<void> {
  if (!/^g_[A-Za-z0-9_-]+$/u.test(gameId) || !/^j_[A-Za-z0-9_-]+$/u.test(requestId))
    throw new Error('invalid QA game or request ID');
  const cell = page.locator(`[data-game-id="${gameId}"]`);
  await cell.waitFor({ state: 'visible', timeout: 60_000 });
  const progress = cell.locator('.games-spotlight-job');
  await progress.waitFor({ state: 'visible', timeout: 60_000 });
  if (!(await progress.innerText()).trim()) throw new Error('the new game shows no progress');

  const until = Date.now() + 180_000;
  for (;;) {
    const report = await api.report(gameId);
    const job = report.jobs.find((item) => item.id === requestId && item.kind === 'new_game');
    if (job?.repo?.toLowerCase() === repo.toLowerCase() && job.issue !== null) {
      const context = await api.context(requestId);
      if (context.parent?.repo.toLowerCase() !== repo.toLowerCase())
        throw new Error('private context names the wrong repository');
      const failure = parentFailure(await parents(repo, requestId), context, gameId, QA_TURNS);
      if (failure) throw new Error(failure);
      return;
    }
    if (Date.now() >= until) throw new Error('the New Game parent was not filed');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
