export type NewGameParent = { number: number; repo: string; title: string; labels: string[]; body: string };
export function sameQaRepo(value: unknown, repo: string): boolean {
  return typeof value === 'string' && value.toLowerCase() === repo.toLowerCase();
}
export function assertQaRepositories(
  inventory: { repo: string | null; instanceRepo: string },
  qaRepo: string,
  instanceRepo: string,
): void {
  if (!sameQaRepo(inventory.repo, qaRepo) || !sameQaRepo(inventory.instanceRepo, instanceRepo))
    throw new Error('configured repositories do not match the selected API');
}
export type NewGamePrivateContext = {
  request: string;
  game: { id: string };
  parent: { repo: string; number: number } | null;
  messages: { actor: string; text: string | null }[];
};

/** Older QA games predate the separate repository; reject any other destination before cleanup. */
export function qaCleanupRepository(recorded: string | null | undefined, qaRepo: string, instanceRepo: string): string {
  const repo = recorded ?? instanceRepo;
  if (![qaRepo.toLowerCase(), instanceRepo.toLowerCase()].includes(repo.toLowerCase()))
    throw new Error('QA game names an unexpected repository');
  return repo;
}

/** Fail closed before touching GitHub or deleting a row; a null repo URL does not prove the folder is absent. */
export function cleanupTargetFailure(report: QaGameReport, repo: string): string | null {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u.test(repo)) return 'invalid repository';
  if (!report.game.path || !/^games\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(report.game.path)) return 'invalid game folder';
  if (report.game.repoUrl !== null && report.game.repoUrl.toLowerCase() !== `https://github.com/${repo}`.toLowerCase())
    return 'game repository does not match';
  if (report.game.repoUrl === null && (report.jobs.length > 0 || report.tickets.length > 0 || report.daemon))
    return 'unprovisioned game has unexpected work';
  if (!report.game.slug || report.game.slug.length > 48 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(report.game.slug))
    return 'invalid game slug';
  if (report.game.path !== `games/${report.game.slug}`) return 'game folder does not match its daemon slug';
  if (report.daemon && report.daemon.repo.toLowerCase() !== repo.toLowerCase())
    return 'daemon repository does not match';
  if (report.jobs.some((job) => job.kind !== 'new_game' && job.kind !== 'scope')) return 'unexpected job on QA game';
  if (report.jobs.some((job) => job.repo !== null && job.repo.toLowerCase() !== repo.toLowerCase()))
    return 'job repository does not match';
  if (
    !Array.isArray(report.sessions) ||
    report.sessions.some(
      (session) =>
        !/^[A-Za-z0-9_-]+$/u.test(session.id) ||
        !report.jobs.some((job) => job.id === session.jobId && job.kind === 'scope'),
    ) ||
    new Set(report.sessions.map((session) => session.id)).size !== report.sessions.length ||
    new Set(report.sessions.map((session) => session.jobId)).size !== report.sessions.length ||
    report.tickets.some(
      (ticket) => ticket.key === 'scope' && !report.sessions.some((session) => session.jobId === ticket.jobId),
    )
  )
    return 'QA scope session does not match its job';
  const seen = new Set<number>();
  for (const ticket of report.tickets) {
    const job = report.jobs.find((candidate) => candidate.id === ticket.jobId);
    if (
      !job ||
      ticket.repo.toLowerCase() !== repo.toLowerCase() ||
      ticket.issue < 1 ||
      !Number.isSafeInteger(ticket.issue) ||
      seen.has(ticket.issue)
    )
      return 'unexpected QA ticket';
    if (ticket.key !== (job.kind === 'scope' ? 'scope' : 'new-game')) return 'unexpected QA ticket';
    seen.add(ticket.issue);
  }
  if (
    report.jobs.some(
      (job) =>
        job.issue !== null && !report.tickets.some((ticket) => ticket.jobId === job.id && ticket.issue === job.issue),
    )
  )
    return 'QA job ticket is missing from the report';
  return null;
}

export function cleanupFailure(report: QaGameReport, repo: string): string | null {
  const target = cleanupTargetFailure(report, repo);
  if (target) return target;
  if (report.daemon && report.daemon.status !== 'stopped') return 'QA game daemon is active';
  if (report.jobs.some((job) => !['cancelled', 'done', 'failed'].includes(job.state) || job.releasedAt === null))
    return 'QA game has active jobs';
  return null;
}

/** Verify the parent belongs to this request and that its two test turns stayed in private context. */
export function parentFailure(
  issues: NewGameParent[],
  context: NewGamePrivateContext,
  gameId: string,
  turns: readonly string[],
): string | null {
  if (issues.length !== 1) return 'expected exactly one New Game parent';
  const issue = issues[0]!;
  if (
    !issue.labels.includes('request:new-game') ||
    context.parent?.number !== issue.number ||
    context.parent.repo.toLowerCase() !== issue.repo.toLowerCase()
  )
    return 'the parent issue does not match the private context';
  if (context.game.id !== gameId || !context.request) return 'private context does not match the game';
  if (!issue.body.split('\n').some((line) => line.trim() === `- Game: ${gameId}`))
    return 'the parent does not identify the game';
  const reference = issue.body.split('\n').find((line) => line.trim().startsWith('- Private context reference:'));
  if (reference?.trim() !== `- Private context reference: ${context.request}`)
    return 'the parent does not carry the opaque context reference';
  if (!issue.body.includes('## Creation choices') || !/^Brief:\s*\S/m.test(issue.body))
    return 'the parent is missing its choices or summary';
  if (issue.labels.some((label) => /^[^:]+:(todo|queued|in-progress)$/iu.test(label)))
    return 'the parent carries a dispatch label';
  if (/https?:\/\//iu.test(issue.body)) return 'the parent contains a link or attachment';
  const publicText = `${issue.title}\n${issue.body}`.toLowerCase();
  const canaries = turns.flatMap((turn) => turn.match(/qa-private-canary-[a-z0-9]+/giu) ?? []);
  const publicWords = ` ${(publicText.match(/[a-z0-9]+/gu) ?? []).join(' ')} `;
  const rawExcerpt = turns.some((turn) => {
    const words = turn.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
    return words.some(
      (_, index) => index + 8 <= words.length && publicWords.includes(` ${words.slice(index, index + 8).join(' ')} `),
    );
  });
  if (
    rawExcerpt ||
    turns.some((turn) => publicText.includes(turn.toLowerCase())) ||
    canaries.some((value) => publicText.includes(value.toLowerCase()))
  )
    return 'the parent contains raw chat';
  if (turns.some((turn) => !context.messages.some((message) => message.actor === 'creator' && message.text === turn)))
    return 'private context does not contain both creator turns';
  return null;
}
import type { QaGameReport } from './qa-new-game-api.js';
