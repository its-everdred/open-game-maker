import type {
  EnergyAdminView,
  EnergyCap,
  EnergyCapsUpdate,
  EnergyLimits,
  EnergyResource,
  EnergyWindowName,
} from '@ogm/contracts';

import { NETLIFY_CREDITS_PER_DEPLOY } from './netlify.js';
import type { ProviderReading } from './providers.js';

// Caps an admin sets on this dashboard; everything else (aiur's caps, the fal stop) is owned elsewhere.
export const EDITABLE_CAPS = ['netlify/credits', 'claude/plan', 'codex/plan'] as const;
export type EditableCapId = (typeof EDITABLE_CAPS)[number];
export type EnergyCaps = Record<EditableCapId, number | null>;
export const emptyCaps = (): EnergyCaps => ({ 'netlify/credits': null, 'claude/plan': null, 'codex/plan': null });
export type CapsUpdate = EnergyCapsUpdate;

// Below this share left a resource is limited, matching the ring.
const LIMITED_BELOW = 0.25;
// A month is 52/12 weeks, so a weekly share of a monthly fee is 12/52 of it (not a quarter).
const WEEKS_PER_MONTH = 52 / 12;
// Model mix moves what a percent of a window is worth, so the dollar share of it is a ±10 % range.
const MIX_SPREAD = 0.1;
const MICRO_PER_USD = 1_000_000;
const WINDOW_LABELS: Record<EnergyWindowName, string> = { day: 'Today', week: 'This week', month: 'This month' };

export type ResourceInputs = {
  limits: EnergyLimits;
  usage: Record<EnergyWindowName, number>;
  resetsAt: Record<EnergyWindowName, string>;
  readings: ProviderReading[];
  caps: EnergyCaps;
  falCapMicroUsd: number | null;
  netlifyDeploys: number | null;
  now: Date;
};

type Fields = Omit<EnergyResource, 'left' | 'ageMs' | 'state' | 'range' | 'account'> &
  Partial<Pick<EnergyResource, 'range' | 'account'>>;

const round = (value: number) => Math.round(value * 100) / 100;

function build(fields: Fields, now: Date): EnergyResource {
  const { used, limit } = fields;
  const left = used !== null && limit !== null ? round(Math.max(0, limit - used)) : null;
  const ageMs = fields.observedAt === null ? null : Math.max(0, now.getTime() - Date.parse(fields.observedAt));
  return { account: null, range: null, ...fields, left, ageMs, state: stateOf({ ...fields, left }) };
}

function stateOf({ used, limit, left, basis }: Pick<EnergyResource, 'used' | 'limit' | 'left' | 'basis'>) {
  if (basis === 'unknown' || used === null) return 'unknown' as const;
  if (limit === null || left === null) return 'available' as const;
  if (left <= 0) return 'exhausted' as const;
  return left / limit < LIMITED_BELOW ? ('limited' as const) : ('available' as const);
}

// Percent of the limit left; null when either is unknown (never 0 or 100 by default).
export function leftPercent(resource: Pick<EnergyResource, 'left' | 'limit'>, left = resource.left): number | null {
  if (left === null || resource.limit === null) return null;
  if (resource.limit === 0) return 0;
  return Math.min(100, Math.max(0, Math.round((left / resource.limit) * 100)));
}

const freshness = (reading: ProviderReading): EnergyResource['freshness'] =>
  reading.stale ? 'stale' : reading.basis === 'unknown' ? 'unknown' : 'fresh';

// `claude:seven_day` → `seven_day`, `codex:codex:primary` → `primary`; a provider with no window reads `usage`.
function windowKey({ id, provider }: ProviderReading): string {
  const parts = id.split(':');
  while (parts[0] === provider) parts.shift();
  return parts.join(':') || 'usage';
}

function fromReading(reading: ProviderReading, now: Date): EnergyResource {
  const common = {
    id: `${reading.provider}/${windowKey(reading)}`,
    label: reading.label,
    provider: reading.provider,
    basis: reading.basis,
    resetsAt: reading.resetsAt,
    observedAt: reading.observedAt,
    freshness: freshness(reading),
  };
  if (reading.provider === 'fal') {
    const usd = (micro: number | null) => (micro === null ? null : micro / MICRO_PER_USD);
    return build(
      {
        ...common,
        id: 'fal/ledger',
        kind: 'metered_spend',
        serves: ['images'],
        unit: 'usd',
        used: usd(reading.spentMicroUsd),
        limit: usd(reading.capMicroUsd),
        origin: 'ogm.ledger',
        editable: false,
      },
      now,
    );
  }
  if (reading.provider === 'elevenlabs') {
    return build(
      {
        ...common,
        id: 'elevenlabs/characters',
        kind: 'quota',
        serves: ['voice'],
        unit: 'characters',
        used: reading.amount?.used ?? null,
        limit: reading.amount?.limit ?? null,
        origin: 'provider',
        editable: false,
      },
      now,
    );
  }
  // aiur.usage reports no OpenRouter window, only whether it has a reading; its balance needs aiur.capacity.
  if (reading.provider === 'openrouter' && reading.usedPercent === null) {
    return build(
      {
        ...common,
        id: 'openrouter/balance',
        kind: 'prepaid_balance',
        serves: ['coding'],
        unit: 'usd',
        used: null,
        limit: null,
        origin: 'aiur.usage',
        editable: false,
      },
      now,
    );
  }
  return build(
    {
      ...common,
      kind: 'subscription_window',
      serves: ['coding'],
      unit: 'percent',
      used: reading.usedPercent,
      limit: 100,
      origin: 'aiur.usage',
      editable: false,
    },
    now,
  );
}

// Every admin resource, never summed across kinds: instance caps, provider readings, fal, Netlify.
export function energyResources(inputs: ResourceInputs): EnergyResource[] {
  const { now } = inputs;
  const observedAt = now.toISOString();
  const instance = (['day', 'week', 'month'] as const).map((window) =>
    build(
      {
        id: `instance/${window}`,
        label: WINDOW_LABELS[window],
        provider: 'ogm',
        kind: 'cap',
        serves: ['coding'],
        unit: 'usd',
        used: inputs.usage[window] / MICRO_PER_USD,
        limit: inputs.limits[window] === null ? null : inputs.limits[window] / MICRO_PER_USD,
        // The build ledger books each build's estimate before it runs.
        basis: 'estimate',
        resetsAt: inputs.resetsAt[window],
        observedAt,
        freshness: 'fresh',
        origin: 'admin',
        editable: true,
      },
      now,
    ),
  );
  const falBalance = build(
    {
      id: 'fal/balance',
      label: 'fal balance',
      provider: 'fal',
      kind: 'prepaid_balance',
      serves: ['images'],
      unit: 'usd',
      used: null,
      limit: null,
      // Reading it needs a billing-scoped fal key, which is not configured.
      basis: 'unknown',
      resetsAt: null,
      observedAt: null,
      freshness: 'unknown',
      origin: 'provider',
      editable: false,
    },
    now,
  );
  const deploys = inputs.netlifyDeploys;
  const netlify = build(
    {
      id: 'netlify/credits',
      label: 'Netlify',
      provider: 'netlify',
      kind: 'quota',
      serves: ['deploy'],
      unit: 'credits',
      used: deploys === null ? null : deploys * NETLIFY_CREDITS_PER_DEPLOY,
      limit: inputs.caps['netlify/credits'],
      basis: deploys === null ? 'unknown' : 'estimate',
      resetsAt: inputs.resetsAt.month,
      observedAt: deploys === null ? null : observedAt,
      freshness: deploys === null ? 'unknown' : 'fresh',
      origin: 'ogm.ledger',
      editable: true,
    },
    now,
  );
  const readings = inputs.readings.map((reading) => fromReading(reading, now));
  const fal = readings.findIndex((resource) => resource.id === 'fal/ledger');
  readings.splice(fal + 1, 0, falBalance);
  return [...instance, ...readings, netlify];
}

export function energyCaps(caps: EnergyCaps, falCapMicroUsd: number | null): EnergyCap[] {
  return [
    {
      id: 'fal/stop',
      label: 'fal stop',
      unit: 'usd',
      limit: falCapMicroUsd === null ? null : falCapMicroUsd / MICRO_PER_USD,
      editable: false,
      origin: 'ogm.ledger',
      layer: 'OGM_FAL_STOP_USD',
    },
    {
      id: 'netlify/credits',
      label: 'Netlify credits a month',
      unit: 'credits',
      limit: caps['netlify/credits'],
      editable: true,
      origin: 'admin',
      layer: null,
    },
    {
      id: 'claude/plan',
      label: 'Claude plan a month',
      unit: 'usd',
      limit: caps['claude/plan'],
      editable: true,
      origin: 'admin',
      layer: null,
    },
    {
      id: 'codex/plan',
      label: 'Codex plan a month',
      unit: 'usd',
      limit: caps['codex/plan'],
      editable: true,
      origin: 'admin',
      layer: null,
    },
  ];
}

// The known limit with least left among what a build needs (coding, images, voice; not deploys).
export function bindingConstraint(resources: EnergyResource[]): EnergyAdminView['pool']['binding'] {
  let binding: EnergyAdminView['pool']['binding'] = null;
  for (const resource of resources) {
    if (resource.serves.includes('deploy') || resource.freshness !== 'fresh') continue;
    const left = leftPercent(resource);
    if (left === null || (binding && binding.leftPercent <= left)) continue;
    binding = {
      id: resource.id,
      label: resource.label,
      leftPercent: left,
      resetsAt: resource.resetsAt,
      freshness: resource.freshness,
    };
  }
  return binding;
}

// D5: a weekly share of each set plan fee, and the used share of it from the provider's weekly window (the
// window that resets last), as a range. Estimates only; a stale or unknown window leaves the used share unknown.
export function subscriptionEstimates(resources: EnergyResource[], caps: EnergyCaps): EnergyAdminView['subscriptions'] {
  const plans = [
    { id: 'claude/plan', provider: 'claude', label: 'Claude' },
    { id: 'codex/plan', provider: 'codex', label: 'Codex' },
  ] as const;
  return plans.flatMap(({ id, provider, label }) => {
    const plan = caps[id];
    if (plan === null) return [];
    const weekly = round(plan / WEEKS_PER_MONTH);
    const weekWindow = resources
      .filter((r) => r.provider === provider && r.kind === 'subscription_window' && r.used !== null)
      .sort((a, b) => Date.parse(b.resetsAt ?? '') - Date.parse(a.resetsAt ?? ''))[0];
    const used = weekWindow?.used ?? null;
    return [
      {
        id,
        label,
        planUsdPerMonth: plan,
        weeklyUsd: weekly,
        usedUsd:
          used === null
            ? null
            : {
                low: round(Math.max(0, (used / 100) * weekly * (1 - MIX_SPREAD))),
                high: round(Math.min(weekly, (used / 100) * weekly * (1 + MIX_SPREAD))),
              },
        basis: 'estimate' as const,
      },
    ];
  });
}
