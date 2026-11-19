import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import { NewGameQaApi } from './qa-new-game-api.js';
import { closeQaCreationPull } from './qa-new-game-creation-pull.js';
import { createQaFolderGit, type GitHubRequest } from './qa-new-game-folder-github.js';
import { removeQaFolder } from './qa-new-game-folder.js';
import { closeQaParent } from './qa-new-game-github.js';
import { assertNoQaIssues, assertQaJobTickets, closeQaScopeIssue, qaScopePaths } from './qa-new-game-issues.js';
import { closeQaScopePulls } from './qa-new-game-open-pulls.js';
import { assertQaFolderOwnership } from './qa-new-game-ownership.js';
import { verifyUnprovisionedQaGame } from './qa-new-game-unprovisioned.js';
import type { QaCleanupServices } from './qa-new-game-cleanup.js';

/** Bind cleanup to the dedicated QA session and the host's existing GitHub credential. */
export function hostQaCleanup(
  api: NewGameQaApi,
  repo: string,
  cookie: { name: string; value: string },
  run: string,
  request: GitHubRequest,
  env?: Record<string, string | undefined>,
  readyToDelete: () => Promise<void> = async () => undefined,
  terminalCreate?: (gameId: string) => Promise<boolean>,
): QaCleanupServices {
  const folders = new Map<string, ReturnType<typeof createQaFolderGit>>();
  const unprovisioned = new Map<string, string>();
  let scopePaths: string[] = [];
  const gitFor = (folder: string) => {
    const existing = folders.get(folder);
    if (existing) return existing;
    const suffix = createHash('sha256').update(folder).digest('hex').slice(0, 8);
    const git = createQaFolderGit(repo, folder, `${run.slice(0, 30)}-${suffix}`, request, {}, scopePaths);
    folders.set(folder, git);
    return git;
  };
  return {
    report: (id) => api.report(id),
    readyToDelete,
    async checkOwnership(folder, id) {
      const report = await api.report(id);
      if (report.game.repoUrl === null) {
        if (!terminalCreate) throw new Error('commit audit check is unavailable');
        await verifyUnprovisionedQaGame(repo, folder, id, gitFor(folder), request, terminalCreate);
        unprovisioned.set(folder, id);
      } else await assertQaFolderOwnership(repo, folder, id, request);
    },
    cancel: (id) => api.cancelJob(id, cookie),
    checkTickets: (job, tickets) => assertQaJobTickets(repo, job, tickets, request),
    async unitStopped(slug) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) || slug.length > 48) throw new Error('invalid QA daemon slug');
      try {
        const result = await promisify(execFile)(
          'systemctl',
          ['--user', 'show', `ogm-aiur@${slug}.service`, '--property=ActiveState', '--value'],
          { ...(env ? { env } : {}), timeout: 30_000, maxBuffer: 8_000 },
        );
        return ['inactive', 'failed'].includes(result.stdout.trim());
      } catch {
        throw new Error('could not verify the QA daemon unit');
      }
    },
    closeParent: (job, game, issue) => closeQaParent(repo, job, game, issue, request),
    closeScopeIssue: (job, issue) => closeQaScopeIssue(repo, job, issue, request),
    async closeCreationPull(folder) {
      const id = unprovisioned.get(folder);
      if (id) await verifyUnprovisionedQaGame(repo, folder, id, gitFor(folder), request, terminalCreate!);
      else await closeQaCreationPull(repo, folder, request);
    },
    async closeScopePulls(folder, issues) {
      scopePaths = await qaScopePaths(repo, issues, request);
      const recovered = unprovisioned.has(folder) ? null : await gitFor(folder).recover?.();
      await closeQaScopePulls(
        repo,
        folder,
        issues,
        request,
        recovered && !recovered.merged ? { number: recovered.pull, head: recovered.head } : undefined,
      );
    },
    noOpenIssues: (slug) => assertNoQaIssues(repo, slug, request),
    async removeFolder(folder) {
      await removeQaFolder(folder, gitFor(folder), unprovisioned.has(folder), scopePaths);
    },
    deleteGame: (id, folder, jobs, tickets, sessions) => api.deleteGame(id, folder, jobs, tickets, sessions, run, repo),
    async gameExists(id) {
      const result = await api.games();
      if (!Array.isArray(result.games) || result.games.some((game) => typeof game.id !== 'string'))
        throw new Error('invalid QA inventory');
      return result.games.some((game) => game.id === id);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
