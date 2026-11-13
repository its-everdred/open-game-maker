import { describe, expect, it } from 'vitest';
import type { ChatRow } from '../src/build-chat/store.js';
import { selectStageMedia } from '../src/scenery/stage.js';

function command(jobId: string, at: string, status: string, option: string, mediaId: string): ChatRow {
  return {
    jobId,
    at,
    kind: 'command',
    commandJson: JSON.stringify({
      decision_id: 'decision',
      question: 'Choose',
      status,
      option_id: option,
      options: [
        {
          id: option,
          label: 'Scene',
          media_id: mediaId,
          provenance: { packs: [], assets: [], generator: 'test', built_at: at, aspect: 'scene', kind: 'render' },
        },
      ],
    }),
  } as ChatRow;
}
const rows = new Map<string, ChatRow>([
  ['older', { id: 'older', jobId: 'job', kind: 'image', mediaHash: 'hash', width: 100, height: 100 } as ChatRow],
  ['newer', { id: 'newer', jobId: 'job', kind: 'clip', mediaHash: 'hash', width: 100, height: 100 } as ChatRow],
  ['foreign', { id: 'foreign', jobId: 'other', kind: 'image', mediaHash: 'hash', width: 100, height: 100 } as ChatRow],
]);

describe('approved stage media', () => {
  it('selects the latest answered visual from the same job and ignores open or foreign media', () => {
    const commands = [
      command('job', '2026-01-01T00:00:00Z', 'answered', 'a', 'older'),
      command('job', '2026-01-02T00:00:00Z', 'answered', 'a', 'newer'),
      command('job', '2026-01-03T00:00:00Z', 'open', 'a', 'older'),
      command('job', '2026-01-04T00:00:00Z', 'answered', 'a', 'foreign'),
    ];
    expect(selectStageMedia(commands, (id) => rows.get(id) ?? null, true)?.id).toBe('newer');
  });
  it('omits rejected, off-camera, and disallowed generated options', () => {
    const row = command('job', '2026-01-02T00:00:00Z', 'answered', 'a', 'newer');
    const data = JSON.parse(row.commandJson!);
    data.options[0].aiGenerated = true;
    row.commandJson = JSON.stringify(data);
    expect(selectStageMedia([row], (id) => rows.get(id) ?? null, false)).toBeUndefined();
    data.options[0].aiGenerated = false;
    data.options[0].provenance.view = 'off-camera';
    row.commandJson = JSON.stringify(data);
    expect(selectStageMedia([row], (id) => rows.get(id) ?? null, true)).toBeUndefined();
    data.options[0].provenance.view = 'player';
    data.review = { likes: [], dislikes: [{ option_id: 'a' }] };
    row.commandJson = JSON.stringify(data);
    expect(selectStageMedia([row], (id) => rows.get(id) ?? null, true)).toBeUndefined();
  });
  it('compares command timestamps as instants rather than timestamp strings', () => {
    const later = command('job', '2026-01-01T00:30:00+00:00', 'answered', 'a', 'newer');
    const earlier = command('job', '2026-01-01T01:00:00+02:00', 'answered', 'a', 'older');
    expect(selectStageMedia([earlier, later], (id) => rows.get(id) ?? null, true)?.id).toBe('newer');
  });
  it('orders reviewed choices by their answer time when a review was recorded', () => {
    const olderCommand = command('job', '2026-01-01T00:00:00Z', 'answered', 'a', 'older');
    const newerCommand = command('job', '2026-01-02T00:00:00Z', 'answered', 'a', 'newer');
    olderCommand.commandJson = JSON.stringify({ ...JSON.parse(olderCommand.commandJson!), command_id: 'old-command' });
    newerCommand.commandJson = JSON.stringify({ ...JSON.parse(newerCommand.commandJson!), command_id: 'new-command' });
    const answers = new Map([['job\0old-command', '2026-01-03T00:00:00Z']]);
    expect(selectStageMedia([newerCommand, olderCommand], (id) => rows.get(id) ?? null, true, answers)?.id).toBe(
      'older',
    );
  });
  it('uses the creator’s corrected choice after a review', () => {
    const row = command('job', '2026-01-01T00:00:00Z', 'answered', 'a', 'older');
    const data = JSON.parse(row.commandJson!);
    data.options.push({ id: 'b', label: 'New', media_id: 'newer' });
    data.review = { likes: ['a'], dislikes: [] };
    data.corrected_option_id = 'b';
    row.commandJson = JSON.stringify(data);
    expect(selectStageMedia([row], (id) => rows.get(id) ?? null, true)?.id).toBe('newer');
  });
});
