import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import {
  docsOnly,
  latestReviewerNote,
  overlapProblems,
  relatedWorkProblems,
  reviewerProblems,
} from '../../related-work-check.js';
import { pullFiles, workRead as invoke } from '../../work-io.js';

type Issue = { number: number; labels: { name: string }[] };
type Pull = { number: number; state: string; body: string | null; head: { ref: string } };

const refs = (body: string) =>
  [...body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#\d+(?:\s*(?:,|and)\s*#\d+)*/gi)].flatMap(
    (match) => [...match[0].matchAll(/#(\d+)\b/g)].map((id) => Number(id[1])),
  );
const mentioned = (body: string) => [...body.matchAll(/(?<![\w/])#(\d+)\b/g)].map((match) => Number(match[1]));

/** CI-side check uses GitHub's feature label projection; no aiur daemon is required on the runner. */
export const command: GmCommand = {
  name: 'work pr-check',
  summary: 'check PR related work and same-feature open PR file overlap',
  usage: '--body <file> --base <ref> --pr <number>',
  example: 'work pr-check --body pr.md --base origin/main --pr 123',
  flags: {
    body: { type: 'string', help: 'PR body file' },
    base: { type: 'string', help: 'base commit or ref' },
    pr: { type: 'number', help: 'current PR number' },
  },
  async run(ctx, args, flags) {
    if (
      args.length ||
      typeof flags.body !== 'string' ||
      typeof flags.base !== 'string' ||
      typeof flags.pr !== 'number' ||
      !Number.isSafeInteger(flags.pr) ||
      flags.pr < 1
    )
      throw new UsageError('--body, --base and a positive --pr are required', 'gm help work pr-check');
    let body: string;
    try {
      body = await readFile(resolve(ctx.cwd, flags.body), 'utf8');
    } catch {
      throw new CommandError(`cannot read PR body ${flags.body}`);
    }
    const changed = (await invoke(ctx, 'git', ['-C', ctx.cwd, 'diff', '--name-only', '-z', `${flags.base}...HEAD`]))
      .split('\0')
      .filter(Boolean);
    const problems = relatedWorkProblems(body, changed);
    const warnings: string[] = [];
    if (!docsOnly(changed)) {
      const ticketIds = [...new Set(refs(body))];
      if (!ticketIds.length) problems.push('PR must link its ticket with Closes or Refs to check feature overlap');
      else warnings.push('Aiur reviewer notes are not head-bound and can arrive after this check starts.');
      const lines = <T>(value: string): T[] =>
        value
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as T);
      const issues = await Promise.all(
        ticketIds.map(
          async (id) => JSON.parse(await invoke(ctx, 'gh', ['api', `repos/{owner}/{repo}/issues/${id}`])) as Issue,
        ),
      );
      for (const id of ticketIds) {
        const comments = lines<{ body: string; author_association: string; created_at: string }>(
          await invoke(ctx, 'gh', [
            'api',
            '--paginate',
            `repos/{owner}/{repo}/issues/${id}/comments?per_page=100`,
            '--jq',
            '.[] | tojson',
          ]),
        );
        if (!latestReviewerNote(comments, id))
          problems.push(`No trusted overlap-review note for #${id}; semantic overlap was not checked.`);
        problems.push(...reviewerProblems(body, comments, id));
      }
      const features = new Set(
        issues.flatMap((issue) =>
          issue.labels.map((label) => label.name).filter((label) => label.startsWith('feature:')),
        ),
      );
      for (const issue of issues)
        if (!issue.labels.some((label) => label.name.startsWith('feature:')))
          problems.push(
            `No feature label is projected on linked ticket #${issue.number}; assign its feature before checking overlap.`,
          );
      if (features.size)
        warnings.push(
          'Projected labels can omit unprojected or also-affects membership; inspect the Aiur feature registry.',
        );
      const peers = new Set<number>();
      for (const feature of features) {
        const rows = lines<Issue>(
          await invoke(ctx, 'gh', [
            'api',
            '--paginate',
            `repos/{owner}/{repo}/issues?state=all&labels=${encodeURIComponent(feature)}&per_page=100`,
            '--jq',
            '.[] | select(.pull_request == null) | tojson',
          ]),
        );
        const expected = issues.filter((issue) => issue.labels.some((label) => label.name === feature));
        if (expected.some((issue) => !rows.some((row) => row.number === issue.number)))
          throw new CommandError(`feature projection ${feature} is inconsistent; cannot verify overlap`);
        for (const row of rows) peers.add(row.number);
      }
      if (features.size) {
        const open = lines<Pull>(
          await invoke(ctx, 'gh', [
            'api',
            '--paginate',
            'repos/{owner}/{repo}/pulls?state=open&per_page=100',
            '--jq',
            '.[] | tojson',
          ]),
        );
        const candidates = open.filter(
          (pull) =>
            pull.number !== flags.pr &&
            (mentioned(pull.body ?? '').some((id) => peers.has(id)) ||
              [...peers].some((id) => new RegExp(`(?:^|/)${id}(?:-|$)`).test(pull.head.ref))),
        );
        const pulls: { number: number; state: string; files: string[] }[] = [];
        for (const pull of candidates) {
          pulls.push({ number: pull.number, state: pull.state, files: await pullFiles(ctx, pull.number) });
        }
        problems.push(...overlapProblems(body, changed, pulls, flags.pr));
      }
    }
    if (ctx.json) ctx.out(JSON.stringify({ ok: problems.length === 0, problems, warnings }));
    else {
      problems.forEach(ctx.err);
      warnings.forEach((warning) => ctx.err(`warning: ${warning}`));
    }
    return problems.length ? EXIT.failed : EXIT.ok;
  },
};
