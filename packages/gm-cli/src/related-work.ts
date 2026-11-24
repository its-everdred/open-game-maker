/*
 * `gm context` (#1311): rank a game's earlier, approved work by how much a ticket should build on it, so a worker
 * starts from the forest, ground maps or UI kit the creator already approved instead of from scratch.
 */

export type Issue = { number: number; title: string; body: string; labels: string[] };
export type Pull = { number: number; title: string; body: string; files: string[] };
/** What one ticket's timeline holds: creator verdicts and the merged PRs that belong to it. */
export type History = { verdicts: Verdict[]; pulls: Pull[] };
export type Verdict = { text: string; at: string; positive: boolean };
export type Comment = { body: string; createdAt: string };
export type Reuse = { paths?: string[]; generator?: string; notes?: string };
/** A `docs/<slug>/decisions.json` entry, read leniently: instance files carry fields the strict contract rejects. */
export type Decision = {
  id: string;
  area?: string;
  question?: string;
  status?: string;
  answer?: string | null;
  answered_at?: string | null;
  ticket?: number | null;
  options?: { label?: string; media?: string }[];
  reuse?: Reuse;
};
/** An approved look target from `review/decisions.json`; `target` is relative to the game folder. */
export type Screen = { name: string; target: string; phase?: string; note?: string };

export type RelatedTicket = {
  kind: 'ticket';
  number: number;
  title: string;
  score: number;
  verdict: Verdict | null;
  pulls: { number: number; title: string; files: string[] }[];
  media: string[];
  generators: string[];
};
export type RelatedDecision = {
  kind: 'decision';
  id: string;
  ticket: number | null;
  question: string;
  answer: string;
  score: number;
  media: string[];
  reuse: Reuse | null;
};
export type RelatedScreen = { kind: 'screen'; name: string; target: string; phase: string | null; note: string | null };
export type Related = RelatedTicket | RelatedDecision | RelatedScreen;

const STOP = new Set(
  'the and for with from that this into each then than when what which where while will would should could have has had are was were been being not but all any its our their them they you your one two three more most some such only also make made use used uses build built add adds added ticket tickets game games kevin creator agent agents executor review round rounds work done need needs must just like see new per via the'.split(
    ' ',
  ),
);

const LOOK = /\b(kit|skin|style|palette)s?\b/i;

export function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if ((word.length >= 3 || word === 'ui') && !STOP.has(word) && !/^\d+$/.test(word)) out.add(word);
  }
  return out;
}

/** Inverse document frequency over the game's tickets: a word every ticket uses says nothing about relatedness. */
function idfOf(documents: Set<string>[]): (term: string) => number {
  const df = new Map<string, number>();
  for (const doc of documents) for (const term of doc) df.set(term, (df.get(term) ?? 0) + 1);
  const n = documents.length + 1;
  return (term) => Math.log(n / (1 + (df.get(term) ?? 0))) + 1;
}

/**
 * Whether a merged PR that mentions `ticket` belongs to it: a PR that names its own tickets with `Closes/Refs #N`
 * belongs only to those (a forest PR that mentions the fields ticket is the forest's); one that names none belongs to
 * every ticket it mentions.
 */
export function belongsTo(body: string, ticket: number): boolean {
  const linked = [...body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)\b/gi)].map((m) =>
    Number(m[1]),
  );
  return linked.length === 0 || linked.includes(ticket);
}

function dirs(paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.length > 1) out.add(parts.slice(0, -1).join('/'));
  }
  return out;
}

const NEGATIVE = /\b(dislike|dislikes|revise|revision|reject|rejected|changes|terrible|bad|wrong|no)\b/i;
const POSITIVE = /\b(like|likes|liked|love|loved|approve|approved|good|great|perfect|yes|keep)\b/i;

/**
 * Creator verdicts the review relay writes on a ticket: `Kevin's review-page verdict, his words: …` lines and
 * `## Answered decision` blocks. A verdict is positive when it likes or approves something; an answered pick is
 * positive unless it asks for a revision.
 */
export function verdicts(comments: Comment[]): Verdict[] {
  const out: Verdict[] = [];
  for (const comment of comments) {
    for (const match of comment.body.matchAll(/review-page verdict, his words:\s*(.+)/g)) {
      const text = match[1]!.trim();
      out.push({ text, at: comment.createdAt, positive: POSITIVE.test(text) });
    }
    if (/^## Answered decision/m.test(comment.body)) {
      const answer = /\*\*Answer:\*\*\s*(.+)/.exec(comment.body)?.[1]?.trim();
      if (answer) out.push({ text: answer, at: comment.createdAt, positive: !NEGATIVE.test(answer) });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export type Candidate = { issue: Issue; score: number };

/**
 * First pass, before any timeline is read: score each sibling by shared `role:*` labels (3 each), a shared `feature:*`
 * label (1), and rare words shared in titles (double) and bodies (the ten rarest, half).
 */
export function candidates(target: Issue, siblings: Issue[]): Candidate[] {
  const text = (issue: Issue) => terms(`${issue.title}\n${issue.body}`);
  const targetTerms = text(target);
  const idf = idfOf([targetTerms, ...siblings.map(text)]);
  const out: Candidate[] = [];
  for (const issue of siblings) {
    if (issue.number === target.number) continue;
    let score = 0;
    for (const label of issue.labels) {
      if (!target.labels.includes(label)) continue;
      if (label.startsWith('role:')) score += 3;
      else if (label.startsWith('feature:')) score += 1;
    }
    const title = terms(issue.title);
    const body = terms(issue.body);
    for (const term of title) if (targetTerms.has(term)) score += 2 * idf(term);
    const bodyShared = [...body]
      .filter((term) => targetTerms.has(term) && !title.has(term))
      .map(idf)
      .sort((a, b) => b - a)
      .slice(0, 10);
    score += 0.5 * bodyShared.reduce((sum, value) => sum + value, 0);
    out.push({ issue, score });
  }
  return out.sort((a, b) => b.score - a.score || b.issue.number - a.issue.number);
}

function mediaOf(decision: Decision): string[] {
  const answer = decision.answer ?? '';
  const picked = (decision.options ?? []).filter(
    (option) => option.label && option.media && (answer === option.label || answer.startsWith(`${option.label}:`)),
  );
  return picked.map((option) => option.media!);
}

export type RankInput = {
  target: Issue;
  candidates: Candidate[];
  /** Timelines read for the target and the top candidates. */
  history: Map<number, History>;
  decisions: Decision[];
  screens: Screen[];
  folders: (ticket: number) => { media: string[]; generators: string[] };
  gamePrefix: string;
  limit: number;
};

/**
 * Second pass: keep siblings that hold approved work (a positive verdict, an answered decision, an approved screen in
 * their review folder, or a merged PR) and add 5, 2 and 3 for the first three, plus 2 per folder their PRs touched that
 * the target's PRs or body also name (at most 6); then rank answered decisions and approved screens against the
 * target's words and the kept siblings.
 */
export function rank(input: RankInput): Related[] {
  const { target, decisions, screens, gamePrefix, limit } = input;
  const targetTerms = terms(`${target.title}\n${target.body}`);
  const targetDirs = dirs([
    ...(input.history.get(target.number)?.pulls ?? []).flatMap((pull) => pull.files),
    ...[...target.body.matchAll(/(?:^|[\s`(])((?:games|packages|src|docs|review)\/[\w./-]+)/g)].map((m) => m[1]!),
  ]);
  const visual = target.labels.includes('role:visual');
  const answered = decisions.filter((d) => (d.status === 'answered' || d.status === 'defaulted') && d.answer);
  const tickets: RelatedTicket[] = [];
  for (const candidate of input.candidates) {
    const number = candidate.issue.number;
    const history = input.history.get(number) ?? { verdicts: [], pulls: [] };
    const verdict = [...history.verdicts].reverse().find((v) => v.positive) ?? null;
    const hasDecision = answered.some((d) => d.ticket === number);
    const hasScreen = screens.some((s) => new RegExp(`(^|/)review/${number}(?:[-/]|$)`).test(s.target));
    if (!verdict && !hasDecision && !hasScreen && history.pulls.length === 0) continue;
    if (candidate.score <= 0) continue;
    const shared = [...dirs(history.pulls.flatMap((pull) => pull.files))].filter((dir) => targetDirs.has(dir)).length;
    const score =
      candidate.score + (verdict ? 5 : 0) + (hasDecision ? 2 : 0) + (hasScreen ? 3 : 0) + Math.min(6, 2 * shared);
    const { media, generators } = input.folders(number);
    tickets.push({
      kind: 'ticket',
      number,
      title: candidate.issue.title,
      score: Math.round(score * 10) / 10,
      verdict,
      pulls: history.pulls.map((pull) => ({ number: pull.number, title: pull.title, files: pull.files })),
      media,
      generators,
    });
  }
  tickets.sort((a, b) => b.score - a.score || b.number - a.number);
  const kept = tickets.slice(0, limit);
  const keptNumbers = new Set(kept.map((t) => t.number));

  const related: RelatedDecision[] = [];
  for (const decision of answered) {
    /* The question names the thing decided; a long answer shares words with almost any ticket. */
    const words = terms(`${decision.id} ${decision.area ?? ''} ${decision.question ?? ''}`);
    let score = [...words].filter((term) => targetTerms.has(term)).length;
    if (decision.ticket != null && keptNumbers.has(decision.ticket)) score += 3;
    if (decision.ticket === target.number) score += 3;
    /* A kit, skin, style or palette pick holds for every screen of the game, named or not (#31 rebuilt #16's kit). */
    if (visual && LOOK.test(`${decision.id} ${decision.question ?? ''}`)) score += 5;
    else if (visual && decision.area === 'look') score += 2;
    if (score === 0) continue;
    if (decision.reuse) score += 2;
    related.push({
      kind: 'decision',
      id: decision.id,
      ticket: decision.ticket ?? null,
      question: decision.question ?? '',
      answer: decision.answer!,
      score,
      media: [...new Set([...mediaOf(decision), ...(decision.reuse?.paths ?? [])])],
      reuse: decision.reuse ?? null,
    });
  }
  related.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const approvedScreens: RelatedScreen[] = screens
    .map((screen) => {
      let score = [...terms(`${screen.name} ${screen.note ?? ''}`)].filter((term) => targetTerms.has(term)).length;
      const ticket = /(?:^|\/)review\/(\d+)/.exec(screen.target)?.[1];
      if (ticket && keptNumbers.has(Number(ticket))) score += 3;
      return { screen, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ screen }) => ({
      kind: 'screen' as const,
      name: screen.name,
      target: `${gamePrefix}${screen.target}`,
      phase: screen.phase ?? null,
      note: screen.note ?? null,
    }));

  return [...kept, ...related.slice(0, limit), ...approvedScreens];
}

function clip(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function fileList(files: string[]): string {
  const code = files.filter((file) => !/(^|\/)(tests?|__tests__)\/|\.test\.[a-z]+$/.test(file));
  const shown = (code.length > 0 ? code : files).slice(0, 4);
  const more = files.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`;
}

/** The markdown block: one bullet per related ticket, decision and approved screen. */
export function renderRelated(ticket: number, items: Related[]): string[] {
  if (items.length === 0) return [];
  const lines = [
    '## Build on this approved work',
    '',
    `Related approved work for #${ticket} (\`gm context ${ticket}\`). Reuse or extend it before making a new asset, UI kit, biome or system, and say in the workpad what you reused or why none of it applied.`,
    '',
  ];
  for (const item of items) {
    if (item.kind === 'ticket') {
      const verdict = item.verdict
        ? ` — approved ${item.verdict.at.slice(0, 10)}: "${clip(item.verdict.text)}"`
        : item.pulls.length > 0
          ? ' — merged'
          : '';
      lines.push(`- #${item.number} ${item.title}${verdict}`);
      for (const pull of item.pulls.slice(0, 3))
        lines.push(`  - PR #${pull.number} ${pull.title}: ${fileList(pull.files)}`);
      if (item.media.length > 0) lines.push(`  - Media: ${item.media.join(', ')}`);
      if (item.generators.length > 0) lines.push(`  - Generators: ${item.generators.join(', ')}`);
    } else if (item.kind === 'decision') {
      const from = item.ticket ? ` (#${item.ticket})` : '';
      lines.push(`- Decision \`${item.id}\`${from}: ${clip(item.question, 120)} → "${clip(item.answer)}"`);
      if (item.media.length > 0) lines.push(`  - Media: ${item.media.join(', ')}`);
      if (item.reuse?.generator) lines.push(`  - Generator: ${item.reuse.generator}`);
      if (item.reuse?.notes) lines.push(`  - Notes: ${clip(item.reuse.notes)}`);
    } else {
      const phase = item.phase ? ` (${item.phase})` : '';
      lines.push(
        `- Approved screen \`${item.name}\`${phase}: ${item.target}${item.note ? ` — ${clip(item.note)}` : ''}`,
      );
    }
  }
  return lines;
}

const START = '<!-- gm-context:start -->';
const END = '<!-- gm-context:end -->';

/** Put the block at the end of a skill file, replacing an earlier one; an empty block removes it. */
export function injectBlock(skill: string, block: string[]): string {
  const start = skill.indexOf(START);
  const end = skill.indexOf(END);
  const base =
    start >= 0 && end > start
      ? `${skill.slice(0, start).trimEnd()}\n${skill.slice(end + END.length).trimStart()}`
      : skill;
  const trimmed = base.trimEnd();
  return block.length === 0 ? `${trimmed}\n` : `${trimmed}\n\n${START}\n${block.join('\n')}\n${END}\n`;
}
