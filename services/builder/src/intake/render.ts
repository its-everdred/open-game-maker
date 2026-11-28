import { createHash } from 'node:crypto';

import type { JobPlan, RepairTicket } from '@ogm/contracts';
import { isDaemonLabel } from '@ogm/game-repo-template';

type PlanTicket = JobPlan['tickets'][number];

export type RenderIssueInput = {
  jobId: string;
  complexity: number;
  plan: JobPlan;
  ticket: PlanTicket;
  blockedBy: readonly number[];
  shippedSkills: readonly string[];
  planner?: { parent: number; gameSlug: string; role: string; decisions: string[] };
};

export function renderIssue(input: RenderIssueInput): {
  title: string;
  body: string;
  sig: string;
  labels: string[];
} {
  validateStructuredFields(input.plan, input.ticket);
  const sections = [input.plan.summary.trim(), scopeSection(input.plan), acceptanceSection(input.ticket)];
  sections.push(
    [
      '## Creator review track',
      'Before posting the mock, commit a unique track at `games/<game>/review/tracks/<track>.json` on this ticket branch.',
      'Use the current issue number as the first phase ticket; use art for screens, sound for audio, and gameplay for mechanics.',
      'and define ordered `mock`, `prototype`, `build`, and `polish` phases with a template for each.',
      'Push the branch, then submit each round with `gm review post` against the commit containing that track.',
    ].join('\n'),
  );
  if (input.blockedBy.length > 0) sections.push(input.blockedBy.map((number) => `Blocked by #${number}`).join('\n'));
  if (input.planner) {
    sections.push(`Refs #${input.planner.parent}`);
    sections.push(`Decision inventory: games/${input.planner.gameSlug}/docs/decisions.json`);
    sections.push(
      [
        '## Creator decisions',
        ...(input.planner.decisions.length ? input.planner.decisions.map((id) => `- ${id}`) : ['- none']),
      ].join('\n'),
    );
  }
  sections.push(skillsSection(input.ticket, input.shippedSkills));
  const unsigned = sections.join('\n\n');
  const sig = createHash('sha256').update(unsigned).digest('hex');
  return {
    title: input.plan.title.trim().slice(0, 120),
    body: `${unsigned}\n\n<!-- gm-job:${input.jobId} gm-ticket:${input.ticket.key} gm-sig:${sig} -->`,
    sig,
    labels: [
      `complexity:${input.complexity}`,
      `feature:gm-${input.jobId}`,
      'phase:mock',
      'model:low',
      ...(input.planner ? [`game:${input.planner.gameSlug}`, input.planner.role, 'priority:1'] : []),
    ],
  };
}

export function renderRepairIssue(input: { jobId: string; complexity: number; ticket: RepairTicket }): {
  title: string;
  body: string;
  sig: string;
  labels: string[];
} {
  const unsigned = input.ticket.body.replace(/\n?<!-- gm-job:[^\n]* -->/g, '').trim();
  const sig = createHash('sha256').update(unsigned).digest('hex');
  // A daemon's own labels never ride along to a repair ticket: they are the failing job's, not the new one's.
  const extra = input.ticket.labels.filter(
    (label) => !isDaemonLabel(label) && !label.startsWith('complexity:') && !label.startsWith('feature:gm-'),
  );
  return {
    title: input.ticket.title.trim().slice(0, 120),
    body: `${unsigned}\n\n<!-- gm-job:${input.jobId} gm-ticket:repair gm-sig:${sig} -->`,
    sig,
    labels: [...new Set([`complexity:${input.complexity}`, `feature:gm-${input.jobId}`, ...extra])],
  };
}

export function usdFromMicro(microUsd: number): string {
  if (!Number.isSafeInteger(microUsd) || microUsd < 0) throw new TypeError('microUsd must be a non-negative integer');
  const amount = Math.max(1, microUsd);
  const whole = Math.floor(amount / 1_000_000);
  const fraction = String(amount % 1_000_000)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${whole}.${fraction}`;
}

function scopeSection(plan: JobPlan): string {
  const included =
    plan.scope.included.length > 0 ? plan.scope.included.map((value) => `- included: ${value}`) : ['- included: none'];
  const excluded =
    plan.scope.excluded.length > 0 ? plan.scope.excluded.map((value) => `- excluded: ${value}`) : ['- excluded: none'];
  return ['## Scope', ...included, ...excluded].join('\n');
}

function acceptanceSection(ticket: PlanTicket): string {
  const criteria = ticket.acceptanceCriteria.length > 0 ? ticket.acceptanceCriteria : ['none specified'];
  return ['## Acceptance', ...criteria.map((value) => `- ${value}`)].join('\n');
}

function skillsSection(ticket: PlanTicket, shippedSkills: readonly string[]): string {
  const shipped = new Set(shippedSkills);
  const requested = [...new Set(ticket.skills)].filter((name) => shipped.has(name));
  const ordered = [
    ...['gm-core', 'gm-verify'].filter((name) => shipped.has(name)),
    ...requested.filter((name) => name !== 'gm-core' && name !== 'gm-verify'),
  ];
  return ['## Load skills', ...ordered.map((name) => `- ${name}`)].join('\n');
}

function validateStructuredFields(plan: JobPlan, ticket: PlanTicket): void {
  const fields = [
    plan.title,
    plan.summary,
    ...plan.scope.included,
    ...plan.scope.excluded,
    ...ticket.acceptanceCriteria,
    ...ticket.skills,
  ];
  for (const value of fields) {
    if (value.length > 4000) throw new Error('Issue field exceeds 4,000 characters');
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) {
      throw new Error('Issue fields must not contain an email address');
    }
  }
}
