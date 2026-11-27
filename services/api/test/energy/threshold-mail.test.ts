import { describe, expect, it, vi } from 'vitest';
import { schema, openDb, migrate } from '@ogm/db';
import type { EnergyResource } from '@ogm/contracts';
import { sendResourceThresholdMail } from '../../src/energy/threshold-mail.js';
import { aiurReadings } from '../../src/energy/providers.js';
import { energySource } from '../../src/energy/source.js';

function resource(overrides: Partial<EnergyResource> = {}): EnergyResource {
  return {
    id: 'claude/seven_day',
    label: 'Claude',
    provider: 'claude',
    kind: 'subscription_window',
    serves: ['coding'],
    unit: 'percent',
    used: 95,
    limit: 100,
    left: 5,
    range: null,
    basis: 'reported',
    resetsAt: '2026-12-01T00:00:00.000Z',
    observedAt: '2026-11-30T00:00:00.000Z',
    ageMs: 0,
    freshness: 'fresh',
    origin: 'aiur.usage',
    state: 'limited',
    account: null,
    editable: false,
    ...overrides,
  };
}

describe('resource threshold email', () => {
  it('emails only admins at 95%, labels estimates, deduplicates and retries failures', async () => {
    const { db, sqlite } = openDb(':memory:');
    migrate({ sqlite });
    db.insert(schema.allowedUsers)
      .values([
        { email: 'admin@example.com', role: 'admin', addedBy: 'env', addedAt: '2026-01-01' },
        { email: 'maker@example.com', role: 'maker', addedBy: 'env', addedAt: '2026-01-01' },
      ])
      .run();
    const send = vi.fn().mockResolvedValue({ id: 'mail' });
    const mail = { send };
    await sendResourceThresholdMail(db, mail, [resource({ used: 94 }), resource({ id: 'unknown', basis: 'unknown' })]);
    expect(send).not.toHaveBeenCalled();
    await sendResourceThresholdMail(db, mail, [resource()]);
    await sendResourceThresholdMail(db, mail, [resource()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@example.com', subject: 'Minerals is 95% used' }),
    );
    const gas = resource({
      id: 'fal/ledger',
      kind: 'metered_spend',
      serves: ['images'],
      unit: 'usd',
      basis: 'estimate',
    });
    send.mockRejectedValueOnce(new Error('offline'));
    await expect(sendResourceThresholdMail(db, mail, [gas])).rejects.toThrow('Resource threshold mail failed');
    await sendResourceThresholdMail(db, mail, [gas]);
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: 'admin@example.com',
        subject: 'Gas is 95% used',
        text: expect.stringContaining('(estimate)'),
      }),
    );
    const noReset = { ...gas, id: 'fal/no-reset', resetsAt: null };
    await sendResourceThresholdMail(db, mail, [noReset]);
    const sent = send.mock.calls.length;
    await sendResourceThresholdMail(db, mail, [{ ...noReset, used: 40 }]);
    await sendResourceThresholdMail(db, mail, [noReset]);
    expect(send).toHaveBeenCalledTimes(sent + 1);
    sqlite.close();
  });

  it('continues to other admins and resources when one address fails, then retries only the failed mail', async () => {
    const { db, sqlite } = openDb(':memory:');
    migrate({ sqlite });
    db.insert(schema.allowedUsers)
      .values([
        { email: 'a@example.com', role: 'admin', addedBy: 'env', addedAt: '2026-01-01' },
        { email: 'b@example.com', role: 'admin', addedBy: 'env', addedAt: '2026-01-01' },
      ])
      .run();
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 'mail' });
    const gas = resource({
      id: 'fal/ledger',
      kind: 'metered_spend',
      serves: ['images'],
      unit: 'usd',
      basis: 'estimate',
    });
    await expect(sendResourceThresholdMail(db, { send }, [resource(), gas])).rejects.toThrow(
      'Resource threshold mail failed',
    );
    expect(send).toHaveBeenCalledTimes(4);
    await sendResourceThresholdMail(db, { send }, [resource(), gas]);
    expect(send).toHaveBeenCalledTimes(5);
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: 'a@example.com', subject: 'Minerals is 95% used' }),
    );
    sqlite.close();
  });

  it('also emails an allowed configured maintainer and deduplicates admin maintainers', async () => {
    const { db, sqlite } = openDb(':memory:');
    migrate({ sqlite });
    db.insert(schema.allowedUsers)
      .values([
        { email: 'admin@example.com', role: 'admin', addedBy: 'env', addedAt: '2026-01-01' },
        { email: 'maintainer@example.com', role: 'maker', addedBy: 'env', addedAt: '2026-01-01' },
      ])
      .run();
    const send = vi.fn().mockResolvedValue({ id: 'mail' });
    await sendResourceThresholdMail(
      db,
      { send },
      [resource()],
      new Set(['admin@example.com', 'maintainer@example.com', 'absent@example.com']),
    );
    expect(send.mock.calls.map(([message]) => message.to).sort()).toEqual([
      'admin@example.com',
      'maintainer@example.com',
    ]);
    sqlite.close();
  });

  it('uses provider precision when comparing the 95% threshold', async () => {
    const { db, sqlite } = openDb(':memory:');
    migrate({ sqlite });
    db.insert(schema.allowedUsers)
      .values({ email: 'admin@example.com', role: 'admin', addedBy: 'env', addedAt: '2026-01-01' })
      .run();
    const send = vi.fn().mockResolvedValue({ id: 'mail' });
    const make = (used_percent: number) => {
      const readings = aiurReadings('claude', 'Claude', {
        contract: 'aiur.usage',
        provider: {
          freshness: 'fresh',
          observed_at: '2026-11-30T00:00:00Z',
          fields: {
            windows: {
              week: {
                kind: 'rate_limit',
                used_percent,
                resets_at: '2026-12-01T00:00:00Z',
              },
            },
          },
        },
      });
      return energySource({ db, zone: 'UTC', readings }).snapshot(new Date('2026-11-30T00:00:00Z')).resources;
    };
    await sendResourceThresholdMail(db, { send }, make(94.5));
    expect(send).not.toHaveBeenCalled();
    await sendResourceThresholdMail(db, { send }, make(95));
    expect(send).toHaveBeenCalledTimes(1);
    sqlite.close();
  });

  it('renews the claim while a slow email is in flight', async () => {
    const { db, sqlite } = openDb(':memory:');
    migrate({ sqlite });
    db.insert(schema.allowedUsers)
      .values({ email: 'admin@example.com', role: 'admin', addedBy: 'env', addedAt: '2026-01-01' })
      .run();
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const send = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValue(undefined);
      const pending = sendResourceThresholdMail(db, { send }, [resource()]);
      await vi.advanceTimersByTimeAsync(360_000);
      await sendResourceThresholdMail(db, { send }, [resource()]);
      expect(send).toHaveBeenCalledTimes(1);
      finish();
      await pending;
    } finally {
      vi.useRealTimers();
      sqlite.close();
    }
  });
});
