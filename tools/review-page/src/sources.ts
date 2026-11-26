import type { Card, Command, Media } from './cards.ts';
import { commandCard } from './cards.ts';

export interface Source {
  key: string;
  checkout: string;
  repository: string;
  aiur: string;
  gh?: string;
  decideRepo: string;
  id?: string;
  reviewLabel?: string;
}
export type Run = (program: string, args: string[], cwd: string) => string;

function readWithRetry(run: Run, program: string, args: string[], cwd: string): string {
  try {
    return run(program, args, cwd);
  } catch {
    return run(program, args, cwd);
  }
}

/** Fetch all open creator Commands; an unavailable source fails the build closed. */
export function collectCommands(source: Source, run: Run, media: (items: unknown[]) => Media[]): Card[] {
  const listing = readWithRetry(run, source.aiur, ['commands', '--filter', 'open'], source.checkout);
  if (!listing.includes('Commands captured')) throw new Error(`Cannot read Commands for ${source.key}`);
  const ids = [...listing.matchAll(/^(dec_[0-9a-f]+)\s+Needs you\b/gm)].map((match) => match[1]!);
  return ids.flatMap((id) => {
    const response = JSON.parse(readWithRetry(run, source.aiur, ['commands', id, '--json'], source.checkout)) as {
      data?: { selected?: Command };
    };
    const selected = response.data?.selected;
    if (!selected || selected.decision_id !== id) throw new Error(`Cannot read Command ${id}`);
    if (
      selected.authority === 'supervisor_allowed' ||
      (selected.context?.authority_basis !== undefined && selected.context.authority_basis !== 'product') ||
      /^(dispatch stopped|rework_claim|tracker|claim|orphaned|budget|CI\b)|dispatch stopped|:rework_claim|orphaned_claim|tracker retry/i.test(
        selected.question,
      )
    )
      return [];
    const card = commandCard(source.key, selected, media);
    if (source.id) card.source = source.id;
    return [card];
  });
}

/** Build supplemental executor cards from a feed of live round entries. */
export function feedCards(name: string, lines: string, stage: (path: string) => Media | undefined): Card[] {
  const engineGated = ['weapons', 'armor', 'pixel-preview'].includes(name);
  const feedLabels: Record<string, string> = {
    weapons: 'weapons',
    armor: 'armor',
    'pixel-preview': 'pixel preview',
    'tool-trials': 'tool trial',
    humble: 'Humble Bundle',
    site: 'live site',
    rounds: 'round',
  };
  return lines
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const entry = JSON.parse(line) as {
        key: string;
        title?: string;
        repo?: string;
        ticket?: number;
        engine_image?: string;
        image?: string;
        images?: string[];
        options?: string[];
        view_only?: boolean;
        at?: string;
        play?: string;
        link?: string;
        price?: string;
        licence?: string;
        notes?: string;
        plain_title?: boolean;
      };
      if (!entry.key) throw new Error(`Feed ${name} contains a card without a key`);
      const engine = entry.engine_image ? stage(entry.engine_image) : undefined;
      if (engineGated && !engine) return [];
      const items = [engine, ...(entry.image ? [stage(entry.image)] : []), ...(entry.images ?? []).map(stage)].filter(
        (item): item is Media => !!item,
      );
      const shared = [...new Map(items.map((item) => [item.src, item])).values()];
      if (!shared.length && name !== 'humble') return [];
      const labels = entry.view_only ? [] : entry.options?.length ? entry.options : ['Like', 'Dislike'];
      return [
        {
          key: `pack-${name}-${entry.key.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80)}`,
          repo: entry.repo ?? 'core',
          ticket: entry.ticket ?? 0,
          decision: '',
          title: entry.plain_title
            ? (entry.title ?? entry.key)
            : `${entry.title ?? entry.key} — ${feedLabels[name] ?? name}`,
          at: entry.at ?? '',
          mode: 'review' as const,
          shared,
          ...(entry.play?.startsWith('https://') ? { play: entry.play } : {}),
          ...(entry.link?.startsWith('https://') ? { link: entry.link } : {}),
          ...(name === 'humble' ? { top: 1, big: 1 } : {}),
          take: [entry.price, entry.licence, entry.notes].filter(Boolean).join(' · '),
          options: labels.map((label) => ({ id: label.toLowerCase().replace(/[^a-z0-9]/g, '-'), label, media: [] })),
        },
      ];
    });
}

/** Build review cards only for open review tickets that contain usable media. */
export function collectReviewTickets(source: Source, run: Run, mediaFromText: (text: string) => Media[]): Card[] {
  const rows = JSON.parse(
    run(
      source.gh ?? 'gh',
      [
        'issue',
        'list',
        '--repo',
        source.repository,
        '--state',
        'open',
        '--label',
        source.reviewLabel ?? 'agent:human-review',
        '--limit',
        '1000',
        '--json',
        'number,title,body,updatedAt',
      ],
      source.checkout,
    ),
  ) as { number: number; title: string; body: string; updatedAt: string }[];
  return rows.flatMap((issue) => {
    const detail = JSON.parse(
      run(
        source.gh ?? 'gh',
        ['issue', 'view', String(issue.number), '--repo', source.repository, '--json', 'comments'],
        source.checkout,
      ),
    ) as { comments: { body: string }[] };
    const prs = JSON.parse(
      run(
        source.gh ?? 'gh',
        [
          'pr',
          'list',
          '--repo',
          source.repository,
          '--state',
          'open',
          '--search',
          `#${issue.number} in:body`,
          '--limit',
          '100',
          '--json',
          'body',
        ],
        source.checkout,
      ),
    ) as { body: string }[];
    const reference = new RegExp(`#${issue.number}(?!\\d)`);
    const texts = [
      issue.body,
      ...detail.comments.map((comment) => comment.body).filter((body) => body.includes('## Agent Workpad')),
      ...prs.map((pr) => pr.body).filter((body) => reference.test(body)),
    ];
    const media = texts.flatMap((text) => mediaFromText(text || ''));
    const unique = [...new Map(media.map((item) => [item.src, item])).values()];
    if (!unique.length) return [];
    return [
      {
        key: `ticket-${source.key}-${issue.number}`,
        repo: source.key,
        ticket: issue.number,
        decision: '',
        title: issue.title,
        at: issue.updatedAt,
        mode: 'review' as const,
        shared: unique,
        options: [
          { id: 'approve', label: 'Looks good', media: [] },
          { id: 'changes', label: 'Needs changes', media: [] },
        ],
        ...(source.id ? { source: source.id } : {}),
      },
    ];
  });
}
