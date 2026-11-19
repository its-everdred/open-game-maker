import type { GitHubRequest } from './qa-new-game-folder-github.js';
import { qaFolderRemovals } from './qa-new-game-folder.js';

/** The original scaffold instructions bind a creation commit to the immutable game ID. */
export async function assertQaFolderOwnership(repo: string, folder: string, gameId: string, request: GitHubRequest) {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u.test(repo) || !/^g_[A-Za-z0-9_-]+$/u.test(gameId))
    throw new Error('invalid QA ownership target');
  qaFolderRemovals(folder, [], false);
  const root = `/repos/${repo}`;
  for (let page = 1; page <= 20; page += 1) {
    const result = await request('GET', `${root}/commits?path=${encodeURIComponent(folder)}&per_page=100&page=${page}`);
    if (!Array.isArray(result) || result.length > 100) throw new Error('invalid QA folder history');
    for (const value of result) {
      if (typeof value !== 'object' || value === null) throw new Error('invalid QA folder history');
      const commit = value as { sha?: unknown; commit?: { message?: unknown } };
      if (
        typeof commit.commit?.message !== 'string' ||
        !commit.commit.message.split('\n').includes(`Game-Folder: ${folder}`)
      )
        continue;
      if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/u.test(commit.sha))
        throw new Error('invalid QA creation commit');
      const file = (await request('GET', `${root}/contents/${folder}/AGENTS.md?ref=${commit.sha}`)) as {
        encoding?: unknown;
        content?: unknown;
      };
      if (file?.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > 100_000)
        throw new Error('QA folder ownership could not be verified');
      const firstLine = Buffer.from(file.content, 'base64').toString('utf8').split(/\r?\n/u)[0];
      if (firstLine !== `# ${gameId}: notes for coding agents`)
        throw new Error('QA folder ownership does not match game ID');
      return;
    }
    if (result.length < 100) break;
  }
  throw new Error('QA folder ownership could not be verified');
}
