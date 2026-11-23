import { z } from 'zod';

import { IsoTime, MicroUsd } from './api.js';

// Energy (#598): one pool per hosted instance. Players see status and percentages; admins also see costs and providers.
// Mixed resources are never converted into one number: the status is the tightest known limit, else unknown.
export const EnergyPreference = z.enum(['save', 'balanced', 'best']);
export const EnergyWindowName = z.enum(['day', 'week', 'month']);
export const EnergyServiceName = z.enum(['voice', 'images']);
export const EnergyLevel = z.enum(['healthy', 'limited', 'critical', 'unknown']);
// Admin resource kinds (#1219, report §3): never summed across kinds.
export const EnergyResourceKind = z.enum(['subscription_window', 'quota', 'prepaid_balance', 'metered_spend', 'cap']);
export const EnergyUnit = z.enum(['percent', 'usd', 'characters', 'credits']);
export const EnergyFreshness = z.enum(['fresh', 'stale', 'unknown']);
export const EnergyOrigin = z.enum(['aiur.capacity', 'aiur.usage', 'ogm.ledger', 'provider', 'admin']);
export const EnergyResourceState = z.enum([
  'available',
  'last_resort',
  'reserved',
  'limited',
  'held',
  'exhausted',
  'unknown',
]);
export const EnergyServes = z.enum(['coding', 'images', 'voice', 'deploy']);
// How a reading is known: reported by the provider, estimated from listed prices, or unknown (missing or stale).
export const EnergyBasis = z.enum(['reported', 'estimate', 'unknown']);

// null = no limit set, or usage unknown: shown as unknown, never as full or empty.
const Percent = z.number().min(0).max(100).nullable();

// One provider reading (#1217): what is used of it, when it resets and how it is known. No money for players.
export const EnergySource = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    usedPercent: Percent,
    resetsAt: IsoTime.nullable(),
    basis: EnergyBasis,
    // When the provider last measured it; with `stale` the age is shown and the share is unknown.
    observedAt: IsoTime.nullable(),
    stale: z.boolean(),
  })
  .strict();

export const EnergyView = z
  .object({
    level: EnergyLevel,
    preference: EnergyPreference,
    windows: z.array(z.object({ window: EnergyWindowName, usedPercent: Percent, resetsAt: IsoTime }).strict()),
    services: z.array(z.object({ service: EnergyServiceName, usedPercent: Percent }).strict()),
    // Bundles written before #1217 carry no sources.
    sources: z.array(EnergySource).default([]),
  })
  .strict();

export const EnergyLimits = z
  .object({
    day: MicroUsd.nullable(),
    week: MicroUsd.nullable(),
    month: MicroUsd.nullable(),
    voice: MicroUsd.nullable(),
    images: MicroUsd.nullable(),
  })
  .strict();

// An amount in the resource's unit (USD in dollars); null is unknown or no limit, never 0.
const Amount = z.number().min(0).nullable();

// One admin resource (#1219): a provider window, quota, balance, spend or cap, with how and when it is known.
export const EnergyResource = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    provider: z.string().min(1),
    account: z.string().min(1).nullable(),
    kind: EnergyResourceKind,
    serves: z.array(EnergyServes),
    unit: EnergyUnit,
    used: Amount,
    limit: Amount,
    left: Amount,
    // Estimates only: the honest spread of `left`.
    range: z
      .object({ low: z.number().min(0), high: z.number().min(0) })
      .strict()
      .nullable(),
    // How the figures are known; a figure is never a bill.
    basis: EnergyBasis,
    resetsAt: IsoTime.nullable(),
    observedAt: IsoTime.nullable(),
    ageMs: z.number().int().min(0).nullable(),
    freshness: EnergyFreshness,
    origin: EnergyOrigin,
    editable: z.boolean(),
    state: EnergyResourceState,
  })
  .strict();

// A cap shown on the dashboard. OGM's own are editable; a cap another owner sets is read-only and names where it
// is configured (an env name, or aiur's config layer once `aiur.capacity` reports caps).
export const EnergyCap = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    unit: EnergyUnit,
    limit: Amount,
    editable: z.boolean(),
    origin: EnergyOrigin,
    layer: z.string().min(1).nullable(),
  })
  .strict();

// The caps an admin may set here; any other id (an aiur cap, a provider window) is refused.
export const EnergyCapsUpdate = z
  .object({
    'netlify/credits': Amount.optional(),
    'claude/plan': Amount.optional(),
    'codex/plan': Amount.optional(),
  })
  .strict();

// Percent of the limit left at a sample, with the estimate's spread; null left is a gap, never 0.
export const EnergyHistoryPoint = z
  .object({
    at: IsoTime,
    left: Percent,
    low: Percent,
    high: Percent,
    basis: EnergyBasis,
  })
  .strict();

export const EnergyAdminView = EnergyView.extend({
  limits: EnergyLimits,
  usage: z
    .object({
      day: MicroUsd,
      week: MicroUsd,
      month: MicroUsd,
      voice: MicroUsd.nullable(),
      images: MicroUsd.nullable(),
    })
    .strict(),
  // What binds next: the known limit with least left, and when it resets.
  pool: z
    .object({
      binding: z
        .object({
          id: z.string().min(1),
          label: z.string().min(1),
          leftPercent: z.number().min(0).max(100),
          resetsAt: IsoTime.nullable(),
          freshness: EnergyFreshness,
        })
        .strict()
        .nullable(),
    })
    .strict(),
  resources: z.array(EnergyResource),
  caps: z.array(EnergyCap),
  // 30 days of hourly samples per resource, oldest first.
  history: z.array(z.object({ id: z.string().min(1), points: z.array(EnergyHistoryPoint) }).strict()),
  // A subscription's weekly share of its plan fee (12/52 of a month) and the used share, both estimates (D5).
  subscriptions: z.array(
    z
      .object({
        id: z.string().min(1),
        label: z.string().min(1),
        planUsdPerMonth: z.number().min(0),
        weeklyUsd: z.number().min(0),
        usedUsd: z
          .object({ low: z.number().min(0), high: z.number().min(0) })
          .strict()
          .nullable(),
        basis: z.literal('estimate'),
      })
      .strict(),
  ),
}).strict();

export const EnergyPreferenceUpdate = z.object({ preference: EnergyPreference }).strict();

export type EnergyPreference = z.infer<typeof EnergyPreference>;
export type EnergyWindowName = z.infer<typeof EnergyWindowName>;
export type EnergyServiceName = z.infer<typeof EnergyServiceName>;
export type EnergyLevel = z.infer<typeof EnergyLevel>;
export type EnergyBasis = z.infer<typeof EnergyBasis>;
export type EnergySource = z.infer<typeof EnergySource>;
export type EnergyView = z.infer<typeof EnergyView>;
export type EnergyLimits = z.infer<typeof EnergyLimits>;
export type EnergyResource = z.infer<typeof EnergyResource>;
export type EnergyResourceKind = z.infer<typeof EnergyResourceKind>;
export type EnergyFreshness = z.infer<typeof EnergyFreshness>;
export type EnergyCap = z.infer<typeof EnergyCap>;
export type EnergyCapsUpdate = z.infer<typeof EnergyCapsUpdate>;
export type EnergyHistoryPoint = z.infer<typeof EnergyHistoryPoint>;
export type EnergyAdminView = z.infer<typeof EnergyAdminView>;

export const energySchemas = {
  'energy.view.v1': EnergyView,
  'energy.admin-view.v2': EnergyAdminView,
  'energy.limits.v1': EnergyLimits,
  'energy.caps.v1': EnergyCapsUpdate,
  'energy.preference.v1': EnergyPreferenceUpdate,
} satisfies Record<string, z.ZodType>;
