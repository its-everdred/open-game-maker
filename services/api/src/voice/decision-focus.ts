import type { Sqlite } from '@ogm/db';

import { findCheckpoint, getChatRow, parseCheckpoint, type ChatRow } from '../build-chat/store.js';

type BriefedCommand = { id: string; question: string; options: { id: string; label: string }[] };

// The decision the creator has open when they start voice from it (#597). The agent cannot see the cards, so the
// briefing says what each one is: a still, a clip or a sound, its size or length, and how it was made. That lets the
// agent explain and compare the options without inventing what they look or sound like.
export function decisionFocus(
  sqlite: Sqlite | undefined,
  jobId: string,
  command: BriefedCommand,
): { title: string; text: string } {
  const row = sqlite === undefined ? null : findCheckpoint(sqlite, jobId, command.id);
  const checkpoint = row === null ? null : parseCheckpoint(row);
  const lines = [`The creator has this decision open and started voice from it: ${command.question}`];
  for (const option of command.options) {
    const stored = checkpoint?.options.find(({ id }) => id === option.id);
    const media = sqlite === undefined || stored?.media_id === undefined ? null : getChatRow(sqlite, stored.media_id);
    const details = [
      ...(media === null || media.jobId !== jobId ? [] : [mediaText(media)]),
      ...(stored?.provenance === undefined ? [] : [provenanceText(stored.provenance)]),
    ].filter((text) => text !== '');
    const recommended = checkpoint?.recommend === option.id ? ' (the builder recommends it)' : '';
    lines.push(`- ${option.label}${recommended}${details.length === 0 ? '' : `: ${details.join('; ')}`}`);
  }
  if (checkpoint?.pick === 'many') lines.push('The creator rates every card, so there is no single option to pick.');
  return { title: 'Open decision', text: lines.join('\n') };
}

// The same rule the review deck uses: a poster means a clip, a length without one means a sound, anything else a still.
function mediaText(row: ChatRow): string {
  if (row.mediaHash === null || row.width === null || row.height === null) return '';
  const length = row.durationMs === null ? '' : `, ${Math.max(1, Math.round(row.durationMs / 1000))} s`;
  if (row.posterHash !== null) return `a video clip, ${row.width}×${row.height}${length}`;
  if (row.durationMs !== null) return `a sound${length}`;
  return `a still image, ${row.width}×${row.height}`;
}

function provenanceText(provenance: NonNullable<ReturnType<typeof parseCheckpoint>>['options'][number]['provenance']) {
  if (provenance === undefined) return '';
  const parts = [
    ...(provenance.kind === undefined ? [] : [provenance.kind]),
    ...(provenance.aspect === undefined ? [] : [`for the ${provenance.aspect}`]),
    ...(provenance.view === undefined ? [] : [`${provenance.view} view`]),
    ...(provenance.packs.length === 0 ? [] : [`from ${provenance.packs.join(', ')}`]),
  ];
  return parts.join(', ');
}
