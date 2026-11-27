import { expect, it } from 'vitest';
import { isComplete, readPicks, relayPicks, validatePick } from './relay.js';

it('waits for every group before relaying a multi-part answer', () => {
  const card = { mode: 'multi', groups: [{ id: 'a' }, { id: 'b' }] } as Parameters<typeof isComplete>[1];
  const pick = { key: 'round', at: 1, repo: 'core', ticket: 0, choice: { a: 'yes' } };
  expect(isComplete(pick, card)).toBe(false);
  expect(isComplete({ ...pick, choice: { a: 'yes', b: 'yes' } }, card)).toBe(true);
  expect(isComplete({ ...pick, choice: 'note', withdrawn: 'build' }, card)).toBe(true);
});

it('waits for each non-original matrix cell', () => {
  const card = {
    mode: 'matrix',
    rows: [{ cells: [{ id: 'original', orig: true }, { id: 'a' }, { id: 'b' }] }],
  } as Parameters<typeof isComplete>[1];
  const pick = { key: 'matrix', at: 1, repo: 'core', ticket: 0, choice: { a: 'like' } };
  expect(isComplete(pick, card)).toBe(false);
  expect(isComplete({ ...pick, notes: { b: 'Looks good' } }, card)).toBe(true);
});

it('reads ArtifactData document wrappers and direct pick maps', () => {
  const data = { at: 1, repo: 'core', ticket: 2 };
  expect(readPicks([{ path: 'picks/dec_a', data }])[0]).toEqual({ ...data, key: 'dec_a' });
  expect(readPicks({ dec_a: data })[0]).toEqual({ ...data, key: 'dec_a' });
  expect(readPicks({})).toEqual([]);
});

it('defers newer answers to the same card after a failed delivery', async () => {
  const picks = [1, 2].map((at) => ({ key: 'card', at, repo: 'core', ticket: 0 }));
  const delivered = new Set<string>();
  const sent: number[] = [];
  await relayPicks(
    picks,
    delivered,
    async (pick) => {
      sent.push(pick.at);
      if (pick.at === 1) throw new Error('offline');
    },
    async () => {},
  );
  expect(sent).toEqual([1]);
  await relayPicks(
    picks,
    delivered,
    async (pick) => {
      sent.push(pick.at);
    },
    async () => {},
  );
  expect(sent).toEqual([1, 1, 2]);
});

it('refuses picks that change the published target or invent an option', () => {
  const card = {
    key: 'dec_a',
    repo: 'core',
    ticket: 2,
    decision: 'dec_a',
    title: 'Review',
    at: '',
    mode: 'review' as const,
    shared: [],
    options: [{ id: 'yes', label: 'Yes', media: [] }],
  };
  const pick = { key: 'dec_a', at: 1, repo: 'core', ticket: 2, decision: 'dec_a', choice: 'yes' };
  expect(() => validatePick(pick, card)).not.toThrow();
  expect(() => validatePick({ ...pick, ticket: 99 }, card)).toThrow('published card');
  expect(() => validatePick({ ...pick, choice: 'unknown' }, card)).toThrow('invalid choice');
});

it('relays new picks once and records only successful deliveries', async () => {
  const picks = [
    { key: 'dec_b', at: 2, repo: 'core', ticket: 4 },
    { key: 'pack-a', at: 1, repo: 'core', ticket: 0 },
  ];
  const sent: string[] = [];
  const ledger = new Set<string>();
  const send = async (pick: (typeof picks)[number]) => {
    sent.push(pick.key);
  };
  const record = async (marker: string) => {
    ledger.add(marker);
  };
  expect(await relayPicks(picks, ledger, send, record)).toEqual({ sent: 2, skipped: 0, failed: [] });
  expect(sent).toEqual(['pack-a', 'dec_b']);
  expect(await relayPicks(picks, ledger, send, record)).toEqual({ sent: 0, skipped: 2, failed: [] });
  expect(
    await relayPicks(
      [
        { ...picks[0]!, at: 3 },
        { ...picks[0]!, key: 'dec_c', at: 4 },
      ],
      ledger,
      async (pick) => {
        if (pick.key === 'dec_b') throw new Error('offline');
      },
      record,
    ),
  ).toEqual({ sent: 1, skipped: 0, failed: ['dec_b'] });
  expect(ledger.has('dec_b@3')).toBe(false);
  expect(ledger.has('dec_c@4')).toBe(true);
});
