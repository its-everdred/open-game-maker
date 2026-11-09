import { describe, expect, it } from 'vitest';

import { insertChatRow, lastPhase, listSince, toMessage, updateCommand } from '../../src/build-chat/store.js';
import { makeDeps } from '../helpers.js';
import { JOB_ID, OTHER_JOB_ID } from './setup.js';

const ULID = '01JBX2Q7M3K8V5N4R6T9W0YZAB';
const text = (id?: string) => ({
  ...(id ? { id } : {}),
  jobId: JOB_ID,
  actor: 'agent' as const,
  kind: 'text' as const,
  text: 'hi',
});

describe('build chat store', () => {
  // The relay can deliver a line twice (restart, rescan); the agent's id is the idempotency key.
  it('keeps one row for a repeated id', () => {
    const { sqlite } = makeDeps();
    expect(insertChatRow(sqlite, text(ULID)).inserted).toBe(true);
    expect(insertChatRow(sqlite, text(ULID)).inserted).toBe(false);
    expect(listSince(sqlite, JOB_ID, 0)).toHaveLength(1);
  });

  it('lists rows after a cursor in order, for that job only', () => {
    const { sqlite } = makeDeps();
    for (let i = 0; i < 5; i += 1) insertChatRow(sqlite, text());
    insertChatRow(sqlite, { ...text(), jobId: OTHER_JOB_ID });
    const rows = listSince(sqlite, JOB_ID, 3);
    expect(rows.map((row) => row.seq)).toEqual([4, 5]);
  });

  // The poller re-reads the same aiur events every tick.
  it('ignores a second row for the same aiur event of a job', () => {
    const { sqlite } = makeDeps();
    const progress = { jobId: JOB_ID, actor: 'system' as const, kind: 'progress' as const, text: 'step' };
    expect(insertChatRow(sqlite, { ...progress, aiur: { ticket: '142', eventId: 7 } }).inserted).toBe(true);
    expect(insertChatRow(sqlite, { ...progress, aiur: { ticket: '142', eventId: 7 } })).toEqual({
      row: null,
      inserted: false,
    });
    expect(
      insertChatRow(sqlite, { ...progress, jobId: OTHER_JOB_ID, aiur: { ticket: '9', eventId: 7 } }).inserted,
    ).toBe(true);
  });

  // A Command answered after later rows must reach `since` readers again, ahead of every row inserted after it.
  it('moves an updated command to the end of the sequence', () => {
    const { sqlite } = makeDeps();
    const command = {
      decision_id: '',
      question: 'Which door?',
      options: [{ id: 'a', label: 'Wood' }],
      status: 'open' as const,
    };
    insertChatRow(sqlite, { id: ULID, jobId: JOB_ID, actor: 'agent', kind: 'command', command });
    insertChatRow(sqlite, text());
    const updated = updateCommand(sqlite, ULID, { decision_id: 'd_1', status: 'answered' });
    expect(updated?.seq).toBe(3);
    expect(listSince(sqlite, JOB_ID, 2).map((row) => row.id)).toEqual([ULID]);
    expect(insertChatRow(sqlite, text()).row?.seq).toBe(4);
    expect(JSON.parse(updated!.commandJson!)).toMatchObject({ decision_id: 'd_1', status: 'answered' });
  });

  it('remembers the last phase row', () => {
    const { sqlite } = makeDeps();
    expect(lastPhase(sqlite, JOB_ID)).toBeNull();
    insertChatRow(sqlite, {
      jobId: JOB_ID,
      actor: 'system',
      kind: 'progress',
      text: 'plan',
      aiur: { ticket: '1', topic: 'phase' },
    });
    insertChatRow(sqlite, {
      jobId: JOB_ID,
      actor: 'system',
      kind: 'progress',
      text: 'work',
      aiur: { ticket: '1', topic: 'phase' },
    });
    expect(lastPhase(sqlite, JOB_ID)).toBe('work');
  });

  it('mints media URLs at read time and never stores them', async () => {
    const { sqlite } = makeDeps();
    const hash = `sha256:${'a'.repeat(64)}` as const;
    const { row } = insertChatRow(sqlite, {
      id: ULID,
      jobId: JOB_ID,
      actor: 'agent',
      kind: 'image',
      media: { hash, width: 64, height: 48 },
    });
    const message = await toMessage(row!, async (h) => `https://blobs.example.test/${h.slice(7, 11)}?sig=x`);
    expect(message.media).toEqual({ url: 'https://blobs.example.test/aaaa?sig=x', width: 64, height: 48 });
    expect(JSON.stringify(row)).not.toContain('https://');
  });
});
