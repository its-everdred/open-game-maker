import { markdownSection } from './decision-inventory.js';

/** Documentation-only changes do not introduce a second implementation. */
export function docsOnly(paths: string[]): boolean {
  return (
    paths.length > 0 &&
    paths.every(
      (path) =>
        /\.(?:md|mdx|rst|txt)$/i.test(path) ||
        (/(?:^|\/)docs\//i.test(path) && /\.(?:png|jpe?g|gif|svg|webp|pdf)$/i.test(path)),
    )
  );
}

/** Require an explicit review, including when there is nothing applicable to reuse. */
export function relatedWorkProblems(body: string, paths: string[]): string[] {
  if (docsOnly(paths)) return [];
  const section = markdownSection(body, 'Related work');
  if (!section?.trim()) return ['PR needs a non-empty ## Related work section'];
  const problems: string[] = [];
  for (const field of ['Reused', 'Overlap', 'Verdict']) {
    if (!new RegExp(`^[ \\t]*(?:[-*][ \\t]*)?${field}:[ \\t]*\\S`, 'im').test(section))
      problems.push(`Related work needs ${field}: with an explanation`);
  }
  const verdict = /^[ \t]*(?:[-*][ \t]*)?Verdict:[ \t]*(.+)$/im.exec(section)?.[1]?.trim();
  if (verdict && !/^(?:build\b|extend\s+\S|fold\s+(?:into\s+)?#\d+\b)/i.test(verdict))
    problems.push('Related work verdict must be build, extend a named target, or fold into #ticket');
  return problems;
}

/** Shared files from another open PR need an explicit reference in the review section. */
export function overlapProblems(
  body: string,
  changed: string[],
  pulls: { number: number; state: string; files: string[] }[],
  currentPr?: number,
): string[] {
  const section = markdownSection(body, 'Related work') ?? '';
  const own = new Set(changed);
  return pulls.flatMap((pull) => {
    if (pull.state !== 'open' || pull.number === currentPr) return [];
    const shared = pull.files.filter((file) => own.has(file));
    const target = `#${pull.number}\\b`;
    const overlap = /^[ \t]*(?:[-*][ \t]*)?Overlap:[ \t]*(.+)$/im.exec(section)?.[1] ?? '';
    const distinct = new RegExp(
      `${target}.*\\b(?:distinct|independent|different)\\b|\\b(?:distinct|independent|different)\\b.*${target}`,
      'i',
    );
    const relation = new RegExp(
      `^(?!.*\\b(?:not|never)\\b).*\\b(?:extend|extends|extending|supersede|supersedes|superseding)\\b.*${target}|^(?!.*\\b(?:not|never)\\b).*${target}.*\\b(?:extend|extends|extending|supersede|supersedes|superseding)\\b`,
      'im',
    );
    if (!shared.length || relation.test(section) || (!/\b(?:not|never)\b/i.test(overlap) && distinct.test(overlap)))
      return [];
    return [`Related work must address shared files with overlapping PR #${pull.number}: ${shared.join(', ')}`];
  });
}

/** Treat only trusted, newest Aiur notes as evidence; public issue comments can be forged. */
export function latestReviewerNote(
  comments: { body: string; author_association: string; created_at: string }[],
  ticket?: number,
): { body: string; author_association: string; created_at: string } | undefined {
  return comments
    .filter(
      (comment) =>
        ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association) &&
        /^\*\*Overlap review\*\*\s*\n/i.test(comment.body) &&
        (ticket === undefined || new RegExp(`(?:Before dispatch|At review) for #${ticket}:`, 'i').test(comment.body)),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .at(-1);
}

export function reviewerProblems(
  body: string,
  comments: { body: string; author_association: string; created_at: string }[],
  ticket?: number,
): string[] {
  const latest = latestReviewerNote(comments, ticket);
  const match =
    latest &&
    /(?:Before dispatch|At review) for #\d+: (?:Extend existing|Fold into) (?:open PR|merged PR|ticket) #(\d+)\b/i.exec(
      latest.body,
    );
  if (!match) return [];
  const section = markdownSection(body, 'Related work') ?? '';
  const target = `#${match[1]}\\b`;
  const relation = new RegExp(
    `^(?!.*\\b(?:not|never)\\b).*\\b(?:extend\\w*|supersed\\w*|fold\\w*)\\b.*${target}|^(?!.*\\b(?:not|never)\\b).*${target}.*\\b(?:extend\\w*|supersed\\w*|fold\\w*)\\b`,
    'im',
  );
  return relation.test(section) ? [] : [`Related work must address the overlap review's target #${match[1]}`];
}
