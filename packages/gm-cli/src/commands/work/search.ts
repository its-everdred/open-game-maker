import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadIndex, search } from '@ogm/asset-cards';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { workspaceRoot } from '../../outbox.js';
import { terms } from '../../related-work.js';
import { matchesWorkTicket, pullFiles, workRead as run } from '../../work-io.js';

type Feature = { key: string; label: string };
type Detail = { feature: Feature; members: { id: number; epic: string }[]; also: number[] };
type Issue = { number: number; title: string; state: string; body: string; pull_request?: unknown; updated_at: string };
type Pull = {
  number: number;
  title: string;
  state: string;
  body: string | null;
  head: { ref: string };
  updated_at: string;
  merged_at: string | null;
};

/** Match a feature by key or all of the meaningful search words in its key and label. */
export function matchesFeature(feature: Feature, query: string): boolean {
  if (feature.key === query.toLowerCase()) return true;
  const wanted = [...terms(query)];
  const available = terms(`${feature.key} ${feature.label}`);
  return wanted.length > 0 && wanted.every((word) => available.has(word));
}

function readDecisions(root: string, words: Set<string>): unknown[] {
  const docs = join(root, 'docs');
  if (!existsSync(docs)) return [];
  const found: unknown[] = [];
  for (const entry of readdirSync(docs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(docs, entry.name, 'decisions.json');
    if (!existsSync(path)) continue;
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new CommandError(`invalid decision inventory: ${path}`);
    }
    if (!Array.isArray(data)) throw new CommandError(`decision inventory is not an array: ${path}`);
    for (const decision of data) {
      const text = JSON.stringify(decision).toLowerCase();
      if ([...words].some((word) => text.includes(word))) found.push({ path, decision });
    }
  }
  return found;
}

export const command: GmCommand = {
  name: 'work search',
  summary: 'find feature tickets, PRs and reusable work before starting a round',
  usage: '<topic or feature> [--aiur-root <launch directory>]',
  example: 'work search dusk-helm-combat',
  flags: {
    'aiur-root': { type: 'string', help: 'aiur launch directory when the registry is not attached to this workspace' },
  },
  async run(ctx, args, flags) {
    const query = args.join(' ').trim();
    if (!query) throw new UsageError('a topic or feature is required', 'gm work search <topic or feature>');
    const aiurRoot = typeof flags['aiur-root'] === 'string' ? resolve(ctx.cwd, flags['aiur-root']) : ctx.cwd;
    const listing = JSON.parse(await run(ctx, 'aiur-main', ['feature', 'show', '--json'], aiurRoot)) as {
      features: Feature[];
    };
    const features = listing.features.filter((feature) => matchesFeature(feature, query));
    const lines = (value: string) =>
      value
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Issue);
    const allIssues = lines(
      await run(ctx, 'gh', [
        'api',
        '--paginate',
        'repos/{owner}/{repo}/issues?state=all&per_page=100',
        '--jq',
        '.[] | select(.pull_request == null) | tojson',
      ]),
    );
    const selected = features.length ? features : listing.features;
    const allDetails: Detail[] = [];
    for (let index = 0; index < selected.length; index += 4) {
      allDetails.push(
        ...(await Promise.all(
          selected
            .slice(index, index + 4)
            .map(
              async ({ key }) =>
                JSON.parse(await run(ctx, 'aiur-main', ['feature', 'show', key, '--json'], aiurRoot)) as Detail,
            ),
        )),
      );
    }
    const queryTerms = [...terms(query)];
    const ticket = /^#?(\d+)$/.exec(query)?.[1];
    const matchingIds = new Set(
      allIssues
        .filter((issue) => {
          if (ticket) return issue.number === Number(ticket);
          const content = terms(`${issue.title} ${issue.body ?? ''}`);
          return queryTerms.length > 0 && queryTerms.every((word) => content.has(word));
        })
        .map((issue) => issue.number),
    );
    const details = features.length
      ? allDetails
      : allDetails.filter((detail) =>
          [...detail.members.map((member) => member.id), ...detail.also].some((id) => matchingIds.has(id)),
        );
    if (!details.length)
      throw new CommandError(`no aiur feature matches ${query}; inspect aiur feature show and use its key`);
    const members = new Set(
      details.flatMap((detail) => [...detail.members.map((member) => member.id), ...detail.also]),
    );
    const issues = allIssues.filter((issue) => members.has(issue.number));
    const missingMembers = [...members].filter((id) => !issues.some((issue) => issue.number === id));
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const pulls = (
      await run(ctx, 'gh', [
        'api',
        '--paginate',
        'repos/{owner}/{repo}/pulls?state=all&sort=updated&direction=desc&per_page=100',
        '--jq',
        '.[] | tojson',
      ])
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Pull)
      .filter((pull) => {
        return (
          (pull.state === 'open' || Date.parse(pull.updated_at) >= cutoff) &&
          matchesWorkTicket(pull.body ?? '', pull.head.ref, members)
        );
      });
    const pullsWithFiles: (Pull & { files: string[] })[] = [];
    for (let index = 0; index < pulls.length; index += 4) {
      pullsWithFiles.push(
        ...(await Promise.all(
          pulls.slice(index, index + 4).map(async (pull) => ({ ...pull, files: await pullFiles(ctx, pull.number) })),
        )),
      );
    }
    const root = workspaceRoot(ctx.cwd);
    const words = terms(query);
    const pathMatches = (await run(ctx, 'git', ['-C', root, 'ls-files']))
      .split('\n')
      .filter(Boolean)
      .map((path) => ({ path, score: [...words].filter((word) => path.toLowerCase().includes(word)).length }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const paths = pathMatches.slice(0, ctx.limit).map((item) => item.path);
    const branches = (await run(ctx, 'git', ['-C', root, 'ls-remote', '--heads', 'origin']))
      .split('\n')
      .filter((line) => [...members].some((number) => new RegExp(`(?:^|/)${number}(?:-|$)`).test(line)));
    const assets = ctx.assetsRoot
      ? search(await loadIndex(ctx.assetsRoot), { words: [...words], use: 'in-game', limit: ctx.limit })
      : null;
    const report = {
      query,
      features: details,
      issues,
      pulls: pullsWithFiles,
      branches,
      decisions: readDecisions(root, words),
      paths,
      assets,
      limitations: [
        'Pulls are associated by ticket references or branch name; inspect unlinked branches separately.',
        'Catalog eligibility is not proof of creator approval; check the decision inventory and review ledger.',
        ...(paths.length < pathMatches.length
          ? [`Tracked-path results limited to ${paths.length} of ${pathMatches.length} matches.`]
          : []),
        ...(missingMembers.length
          ? [`Feature members not found in this repository: ${missingMembers.join(', ')}.`]
          : []),
        ...(ctx.assetsRoot ? [] : ['Asset catalog unavailable.']),
      ],
    };
    ctx.out(JSON.stringify(report, null, ctx.json ? undefined : 2));
    return EXIT.ok;
  },
};
