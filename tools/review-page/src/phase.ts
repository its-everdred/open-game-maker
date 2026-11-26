import type { Pick } from './relay.ts';
import type { Run, Source } from './sources.ts';

const next: Record<string, string> = { mock: 'prototype', prototype: 'build', build: 'polish', polish: 'ship' };
const effort: Record<string, string> = { mock: 'low', prototype: 'medium', build: 'xhigh', polish: 'high' };
const previous: Record<string, string> = { prototype: 'mock', build: 'prototype', polish: 'build' };

export function phaseFor(labels: string[]): { at: string; next: string } | undefined {
  const at = labels.find((label) => label.startsWith('phase:') && next[label.slice(6)])?.slice(6);
  return at ? { at, next: next[at]! } : undefined;
}

export function updatePhase(pick: Pick, source: Source, run: Run): void {
  if (!pick.advance && !pick.withdrawn) return;
  if (pick.advance && !['prototype', 'build', 'polish', 'ship'].includes(pick.advance))
    throw new Error('Invalid review phase');
  if (pick.withdrawn && !previous[pick.withdrawn]) throw new Error('Invalid withdrawn phase');
  const phase = pick.advance === 'ship' ? undefined : (pick.advance ?? previous[pick.withdrawn!]);
  if (!phase) return;
  const result = JSON.parse(
    run(
      source.gh ?? 'gh',
      ['issue', 'view', String(pick.ticket), '--repo', source.repository, '--json', 'labels'],
      source.checkout,
    ),
  ) as { labels: { name: string }[] };
  const keep = [`phase:${phase}`, `model:${effort[phase]}`];
  const remove = result.labels
    .map((label) => label.name)
    .filter((name) => /^(phase:|model:)/.test(name) && !keep.includes(name));
  run(
    source.gh ?? 'gh',
    [
      'issue',
      'edit',
      String(pick.ticket),
      '--repo',
      source.repository,
      '--add-label',
      keep.join(','),
      ...remove.flatMap((name) => ['--remove-label', name]),
    ],
    source.checkout,
  );
}
