import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnergyAdminView, EnergyView } from '@ogm/contracts';

import {
  aiurReadings,
  elevenLabsReading,
  envFileValue,
  falReading,
  providerReadings,
  type ProviderReading,
} from '../../src/energy/providers.js';
import { energySource } from '../../src/energy/source.js';
import { energyLevel, playerView } from '../../src/energy/view.js';
import { asUser, makeApp } from '../helpers.js';
import { ids, NOW, worked, ZONE } from '../budget/fixture.js';

// Shapes as the NUC's aiur daemon returned them on 2026-11-22 (contract `aiur.usage` v1).
const claude = {
  contract: 'aiur.usage',
  contract_version: 1,
  provider: {
    provider: 'claude',
    freshness: 'fresh',
    observed_at: '2026-11-22T22:07:20Z',
    fields: {
      summary_label: 'worst of 2 accounts',
      windows: {
        seven_day: {
          kind: 'rate_limit',
          name: 'Weekly (all models)',
          observed_at: '2026-11-22T22:07:20Z',
          resets_at: '2026-11-27T09:00:00.159733Z',
          used_percent: 53.0,
        },
      },
    },
  },
};
const codex = (freshness: string) => ({
  contract: 'aiur.usage',
  contract_version: 1,
  provider: {
    provider: 'codex',
    freshness,
    observed_at: '2026-11-22T05:07:24.131431Z',
    fields: {
      windows: {
        'codex:credits': { kind: 'credit', freshness, credits: { status: 'available' } },
        'codex:primary': {
          kind: 'rate_limit',
          name: 'Primary',
          freshness,
          observed_at: '2026-11-22T05:07:24.131431Z',
          resets_at: '2026-11-25T16:28:48Z',
          used_percent: 97,
        },
      },
    },
  },
});
const openrouter = {
  contract: 'aiur.usage',
  contract_version: 1,
  provider: { provider: 'openrouter', freshness: 'unknown', observed_at: null, fields: { state: 'no_reading' } },
};
const subscription = {
  character_count: 25_000,
  character_limit: 100_000,
  next_character_count_reset_unix: 1_796_000_000,
};

const at = new Date('2026-11-22T22:10:00.000Z');
const tmp = () => mkdtempSync(join(tmpdir(), 'ogm-energy-'));

describe('aiur usage readings', () => {
  it('reports a fresh window as the provider measured it', () => {
    expect(aiurReadings('claude', 'Claude', claude)).toEqual([
      {
        id: 'claude:seven_day',
        label: 'Claude',
        provider: 'claude',
        kind: 'subscription',
        usedPercent: 53,
        resetsAt: '2026-11-27T09:00:00.159Z',
        observedAt: '2026-11-22T22:07:20.000Z',
        stale: false,
        basis: 'reported',
        spentMicroUsd: null,
        capMicroUsd: null,
      },
    ]);
  });

  // A stale 97 % is not a current 97 %: it must not drive the ring, and a stale reading must never read as 0 either.
  it('turns a stale window into unknown and keeps its age, ignoring credit windows', () => {
    const [primary, ...rest] = aiurReadings('codex', 'Codex', codex('stale'));
    expect(rest).toEqual([]);
    expect(primary).toMatchObject({ id: 'codex:codex:primary', basis: 'unknown', stale: true });
    expect(primary!.usedPercent).toBeNull();
    expect(primary!.observedAt).toBe('2026-11-22T05:07:24.131Z');
  });

  it('is unknown, not 0, when the provider has no reading or the body is not aiur.usage', () => {
    for (const body of [openrouter, { error: 'nope' }, null]) {
      const [reading] = aiurReadings('openrouter', 'OpenRouter', body);
      expect(reading).toMatchObject({ basis: 'unknown', stale: false });
      expect(reading!.usedPercent).toBeNull();
    }
  });
});

describe('fal ledger reading', () => {
  it('books listed prices as an estimate of the cap the ledger carries', () => {
    const path = join(tmp(), 'fal-ledger.json');
    writeFileSync(path, JSON.stringify({ stop_usd: 8, calls: [{ usd: 1.5 }, { usd: 0.5 }] }));
    expect(falReading(path, 9, at)).toMatchObject({
      basis: 'estimate',
      usedPercent: 25,
      spentMicroUsd: 2_000_000,
      capMicroUsd: 8_000_000,
    });
  });

  it('shows no recorded spend, not unknown, when the ledger file does not exist yet', () => {
    expect(falReading(join(tmp(), 'missing.json'), 9, at)).toMatchObject({
      basis: 'estimate',
      usedPercent: 0,
      spentMicroUsd: 0,
      capMicroUsd: 9_000_000,
    });
  });

  it('is unknown when the ledger cannot be read as one', () => {
    const path = join(tmp(), 'fal-ledger.json');
    for (const text of ['{not json', JSON.stringify({ calls: [{ usd: 'one' }] })]) {
      writeFileSync(path, text);
      const reading = falReading(path, 9, at);
      expect(reading.basis).toBe('unknown');
      expect(reading.usedPercent).toBeNull();
      expect(reading.spentMicroUsd).toBeNull();
    }
  });
});

describe('ElevenLabs reading', () => {
  it('reports characters used of the limit and the reset', () => {
    expect(elevenLabsReading(subscription, at.toISOString())).toMatchObject({
      usedPercent: 25,
      basis: 'reported',
      resetsAt: new Date(1_796_000_000_000).toISOString(),
    });
  });

  it('is unknown when the subscription carries no limit', () => {
    expect(elevenLabsReading({ character_count: 5, character_limit: 0 }, at.toISOString()).usedPercent).toBeNull();
  });

  it('reads only the named key from an env file', () => {
    const file = join(tmp(), 'voice-host.env');
    writeFileSync(file, 'OTHER=1\nELEVENLABS_API_KEY="abc123"\n');
    expect(envFileValue(file, 'ELEVENLABS_API_KEY')).toBe('abc123');
    expect(envFileValue(join(tmp(), 'none.env'), 'ELEVENLABS_API_KEY')).toBeNull();
  });
});

describe('provider readings', () => {
  const ledger = () => join(tmp(), 'missing.json');
  const respond = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  const live: typeof fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/usage/claude')) return respond(claude);
    if (url.endsWith('/usage/codex')) return respond(codex('fresh'));
    if (url.endsWith('/usage/openrouter')) return respond(openrouter);
    return respond(subscription);
  };

  it('reads every source once and serves the cache for 60 seconds', async () => {
    const fetcher = vi.fn(live);
    const readings = providerReadings({
      aiur: { baseUrl: 'http://127.0.0.1:4999/', token: 't' },
      elevenLabsKey: () => 'k',
      falLedger: ledger(),
      falCapUsd: 9,
      fetcher,
    });
    const first = await readings.read(at);
    expect(first.map(({ id, usedPercent }) => [id, usedPercent])).toEqual([
      ['codex:codex:primary', 97],
      ['claude:seven_day', 53],
      ['openrouter', null],
      ['fal', 0],
      ['elevenlabs', 25],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(String(fetcher.mock.calls[0]![0])).toBe('http://127.0.0.1:4999/api/v1/usage/codex');
    await readings.read(new Date(at.getTime() + 59_000));
    expect(fetcher).toHaveBeenCalledTimes(4);
    await readings.read(new Date(at.getTime() + 60_000));
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it('turns a refusal, a timeout or a missing key into unknown instead of hanging or reading 0', async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    const refused = await providerReadings({
      aiur: { baseUrl: 'http://127.0.0.1:4999', token: 't' },
      elevenLabsKey: () => 'k',
      falLedger: ledger(),
      falCapUsd: 9,
      fetcher: (input, init) =>
        String(input).includes('elevenlabs') ? respond({ detail: 'unauthorized' }, 401) : hang(input, init),
      timeoutMs: 20,
    }).read(at);
    const keyless = await providerReadings({
      aiur: null,
      elevenLabsKey: () => null,
      falLedger: ledger(),
      falCapUsd: 9,
      fetcher: () => {
        throw new Error('no network when nothing is configured');
      },
    }).read(at);
    for (const readings of [refused, keyless]) {
      const unknown = readings.filter(({ id }) => id !== 'fal');
      expect(unknown.map(({ id }) => id)).toEqual(['codex', 'claude', 'openrouter', 'elevenlabs']);
      for (const reading of unknown) {
        expect(reading.basis).toBe('unknown');
        expect(reading.usedPercent).toBeNull();
      }
    }
  });
});

describe('Energy with provider readings', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));
  afterEach(() => vi.useRealTimers());

  const reading = (id: string, usedPercent: number | null, extra: Partial<ProviderReading> = {}): ProviderReading => ({
    id,
    label: id,
    provider: id,
    kind: 'subscription',
    usedPercent,
    resetsAt: null,
    observedAt: null,
    stale: false,
    basis: usedPercent === null ? 'unknown' : 'reported',
    spentMicroUsd: null,
    capMicroUsd: null,
    ...extra,
  });
  const level = (readings: ProviderReading[]) =>
    energyLevel(energySource({ db: worked().db, zone: ZONE, readings }).snapshot(NOW));

  it('lets the tightest known reading decide the ring', () => {
    expect(level([reading('claude', 53)])).toBe('healthy');
    expect(level([reading('claude', 53), reading('codex', 80)])).toBe('limited');
    expect(level([reading('claude', 53), reading('codex', 100)])).toBe('critical');
  });

  it('lets no unknown or stale reading decide it', () => {
    expect(level([reading('codex', null, { stale: true, observedAt: NOW.toISOString() })])).toBe('unknown');
    expect(level([reading('claude', 10), reading('codex', null)])).toBe('healthy');
  });

  it('fills the voice service from ElevenLabs and lists every source without money', () => {
    const snapshot = energySource({
      db: worked().db,
      zone: ZONE,
      readings: [
        reading('elevenlabs', 40, { service: 'voice' }),
        reading('fal', 20, { kind: 'metered', basis: 'estimate', spentMicroUsd: 1_800_000, capMicroUsd: 9_000_000 }),
      ],
    }).snapshot(NOW);
    const view = playerView(snapshot, 'balanced');
    expect(view.services).toEqual([
      { service: 'voice', usedPercent: 40 },
      { service: 'images', usedPercent: null },
    ]);
    expect(view.sources.map(({ id, basis }) => [id, basis])).toEqual([
      ['elevenlabs', 'reported'],
      ['fal', 'estimate'],
    ]);
    expect(JSON.stringify(view)).not.toMatch(/MicroUsd/);
  });

  it('serves the readings on /energy and the dollars only on /energy/admin', async () => {
    const deps = worked();
    deps.registry.energyReadings = {
      read: async () => [
        reading('claude:seven_day', 53),
        reading('fal', 20, { kind: 'metered', basis: 'estimate', spentMicroUsd: 1_800_000, capMicroUsd: 9_000_000 }),
      ],
    };
    const { app } = await makeApp(deps);
    const player = EnergyView.parse(
      await (await app.request('/api/v1/energy', { headers: asUser(ids.creator) })).json(),
    );
    expect(player.level).toBe('healthy');
    expect(player.sources.map(({ id, usedPercent }) => [id, usedPercent])).toEqual([
      ['claude:seven_day', 53],
      ['fal', 20],
    ]);
    const admin = EnergyAdminView.parse(
      await (await app.request('/api/v1/energy/admin', { headers: asUser(ids.admin) })).json(),
    );
    expect(admin.resources.find(({ provider }) => provider === 'fal')).toMatchObject({
      spentMicroUsd: 1_800_000,
      remainingMicroUsd: 7_200_000,
      basis: 'estimate',
    });
  });
});
