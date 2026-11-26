import { expect, it } from 'vitest';
import { readPicks, relayPicks, validatePick } from './relay.js';

it('reads ArtifactData document wrappers and direct pick maps', () => {
  const data = { at: 1, repo: 'core', ticket: 2 };
  expect(readPicks([{ path: 'picks/dec_a', data }])[0]).toEqual({ ...data, key: 'dec_a' });
  expect(readPicks({ dec_a: data })[0]).toEqual({ ...data, key: 'dec_a' });
  expect(readPicks({})).toEqual([]);
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
