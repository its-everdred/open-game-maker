import { readFileSync } from 'node:fs';

import type { EnergyBasis, EnergyResource } from '@ogm/contracts';

import { safeMicro, usdToMicro } from '../budget/micro.js';

// One provider reading (#1217). A share is null whenever it is unknown or stale: never 0, never 100.
export type ProviderReading = {
  id: string;
  label: string;
  provider: string;
  kind: EnergyResource['kind'];
  usedPercent: number | null;
  resetsAt: string | null;
  observedAt: string | null;
  stale: boolean;
  basis: EnergyBasis;
  // Money, for admins only; null where the provider reports none.
  spentMicroUsd: number | null;
  capMicroUsd: number | null;
  // The player-facing service this reading stands for, if any.
  service?: 'voice';
};

export interface ProviderReadings {
  read(now: Date): Promise<ProviderReading[]>;
}

export type ProviderReadingsDeps = {
  aiur: { baseUrl: string; token: string } | null;
  // Read when a refresh runs, so a rotated key is picked up; null when there is none.
  elevenLabsKey: () => string | null;
  falLedger: string;
  falCapUsd: number;
  fetcher?: typeof fetch;
  ttlMs?: number;
  timeoutMs?: number;
};

const AIUR_PROVIDERS = [
  { provider: 'codex', label: 'Codex' },
  { provider: 'claude', label: 'Claude' },
  { provider: 'openrouter', label: 'OpenRouter' },
] as const;

// fal3d.py's default stop (OGM_FAL_STOP_USD), used when the ledger doesn't record its own.
export const FAL_CAP_USD = 9;
const TTL_MS = 60_000;
// `/energy` waits at most this long for a provider before treating it as unknown.
const TIMEOUT_MS = 1_500;

// Reads every source at most once per TTL; concurrent callers share one refresh.
export function providerReadings(deps: ProviderReadingsDeps): ProviderReadings {
  const ttl = deps.ttlMs ?? TTL_MS;
  let cached: { at: number; readings: Promise<ProviderReading[]> } | null = null;
  return {
    read(now) {
      if (cached && now.getTime() - cached.at < ttl) return cached.readings;
      cached = { at: now.getTime(), readings: readAll(deps, now) };
      return cached.readings;
    },
  };
}

async function readAll(deps: ProviderReadingsDeps, now: Date): Promise<ProviderReading[]> {
  const fetcher = deps.fetcher ?? fetch;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const getJson = async (url: string, headers: Record<string, string>): Promise<unknown> => {
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  const [aiur, elevenLabs] = await Promise.all([
    Promise.all(
      AIUR_PROVIDERS.map(({ provider, label }) =>
        deps.aiur === null
          ? Promise.resolve(unknownAiur(provider, label))
          : getJson(`${deps.aiur.baseUrl.replace(/\/$/, '')}/api/v1/usage/${provider}`, {
              authorization: `Bearer ${deps.aiur.token}`,
            }).then(
              (body) => aiurReadings(provider, label, body),
              () => [unknownAiur(provider, label)],
            ),
      ),
    ),
    readElevenLabs(deps.elevenLabsKey(), getJson),
  ]);
  return [...aiur.flat(), falReading(deps.falLedger, deps.falCapUsd, now), elevenLabs];
}

const unknownReading = (fields: Pick<ProviderReading, 'id' | 'label' | 'provider' | 'kind'>): ProviderReading => ({
  ...fields,
  usedPercent: null,
  resetsAt: null,
  observedAt: null,
  stale: false,
  basis: 'unknown',
  spentMicroUsd: null,
  capMicroUsd: null,
});

function unknownAiur(provider: string, label: string): ProviderReading {
  return unknownReading({ id: provider, label, provider, kind: 'subscription' });
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const iso = (value: unknown): string | null => {
  const text = str(value);
  return text !== null && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : null;
};
const percent = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;

// `aiur.usage` v1: one reading per rate-limit window. A window that isn't fresh is unknown, with its age kept.
export function aiurReadings(provider: string, label: string, body: unknown): ProviderReading[] {
  if (!isObject(body) || body.contract !== 'aiur.usage' || !isObject(body.provider)) {
    return [unknownAiur(provider, label)];
  }
  const record = body.provider;
  const windows = isObject(record.fields) && isObject(record.fields.windows) ? record.fields.windows : {};
  const limits = Object.entries(windows).filter(
    (entry): entry is [string, Json] => isObject(entry[1]) && entry[1].kind === 'rate_limit',
  );
  if (limits.length === 0) return [unknownAiur(provider, label)];
  return limits.map(([key, window]) => {
    const freshness = str(window.freshness) ?? str(record.freshness);
    const used = percent(window.used_percent);
    const observedAt = iso(window.observed_at) ?? iso(record.observed_at);
    const known = freshness === 'fresh' && used !== null;
    return {
      id: `${provider}:${key}`,
      label: limits.length === 1 ? label : `${label} ${str(window.name) ?? key}`,
      provider,
      kind: 'subscription',
      usedPercent: known ? used : null,
      resetsAt: iso(window.resets_at),
      observedAt,
      stale: !known && observedAt !== null,
      basis: known ? 'reported' : 'unknown',
      spentMicroUsd: null,
      capMicroUsd: null,
    };
  });
}

// fal3d.py books each call at its listed price before sending it, so the total is an estimate. No ledger file
// means nothing has been booked yet: 0 of the cap, not unknown.
export function falReading(path: string, defaultCapUsd: number, now: Date): ProviderReading {
  const base = { id: 'fal', label: 'fal', provider: 'fal', kind: 'metered' as const };
  let ledger: unknown;
  try {
    ledger = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return unknownReading(base);
    ledger = { calls: [] };
  }
  if (!isObject(ledger) || !Array.isArray(ledger.calls)) return unknownReading(base);
  const usd = ledger.calls.map((call) => (isObject(call) ? call.usd : undefined));
  if (!usd.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) {
    return unknownReading(base);
  }
  const capUsd = typeof ledger.stop_usd === 'number' && ledger.stop_usd > 0 ? ledger.stop_usd : defaultCapUsd;
  const spent = safeMicro(usdToMicro(usd.reduce((sum, value) => sum + value, 0).toFixed(6)));
  const cap = safeMicro(usdToMicro(capUsd.toFixed(6)));
  return {
    ...base,
    usedPercent: Math.min(100, Math.round((spent / cap) * 100)),
    resetsAt: null,
    observedAt: now.toISOString(),
    stale: false,
    basis: 'estimate',
    spentMicroUsd: spent,
    capMicroUsd: cap,
  };
}

// `GET /v1/user/subscription` is a free read. No key, a refusal or a timeout leaves voice unknown.
async function readElevenLabs(
  key: string | null,
  getJson: (url: string, headers: Record<string, string>) => Promise<unknown>,
): Promise<ProviderReading> {
  const base = { id: 'elevenlabs', label: 'Voice', provider: 'elevenlabs', kind: 'subscription' as const };
  if (key === null) return { ...unknownReading(base), service: 'voice' };
  const observedAt = new Date().toISOString();
  return getJson('https://api.elevenlabs.io/v1/user/subscription', { 'xi-api-key': key }).then(
    (body) => ({ ...elevenLabsReading(body, observedAt), service: 'voice' as const }),
    () => ({ ...unknownReading(base), service: 'voice' as const }),
  );
}

export function elevenLabsReading(body: unknown, observedAt: string): ProviderReading {
  const base = { id: 'elevenlabs', label: 'Voice', provider: 'elevenlabs', kind: 'subscription' as const };
  if (!isObject(body)) return unknownReading(base);
  const { character_count: used, character_limit: limit, next_character_count_reset_unix: reset } = body;
  if (typeof used !== 'number' || typeof limit !== 'number' || limit <= 0 || used < 0) return unknownReading(base);
  return {
    ...base,
    usedPercent: Math.min(100, Math.round((used / limit) * 100)),
    resetsAt: typeof reset === 'number' ? new Date(reset * 1000).toISOString() : null,
    observedAt,
    stale: false,
    basis: 'reported',
    spentMicroUsd: null,
    capMicroUsd: null,
  };
}

// The voice host's ElevenLabs key, read from its env file without sourcing it; never logged or sent to the client.
export function envFileValue(file: string, name: string): string | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match?.[1] === name) return match[2]!.replace(/^(["'])(.*)\1$/, '$2').trim() || null;
  }
  return null;
}
