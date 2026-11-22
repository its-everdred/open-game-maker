import { z } from 'zod';

import { IsoTime, MicroUsd } from './api.js';

// Energy (#598): one pool per hosted instance. Players see status and percentages; admins also see costs and providers.
// Mixed resources are never converted into one number: the status is the tightest known limit, else unknown.
export const EnergyPreference = z.enum(['save', 'balanced', 'best']);
export const EnergyWindowName = z.enum(['day', 'week', 'month']);
export const EnergyServiceName = z.enum(['voice', 'images']);
export const EnergyLevel = z.enum(['healthy', 'limited', 'critical', 'unknown']);
export const EnergyResourceKind = z.enum(['subscription', 'prepaid', 'metered']);
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

export const EnergyResource = z
  .object({
    label: z.string().min(1),
    provider: z.string().min(1),
    kind: EnergyResourceKind,
    // Spend as Game Maker records it (this month for builds, the ledger total for fal); null when not recorded.
    spentMicroUsd: MicroUsd.nullable(),
    // What is left of a known dollar cap; null when there is none.
    remainingMicroUsd: MicroUsd.nullable(),
    // A subscription's next reset; prepaid credits and metered spend have none.
    resetsAt: IsoTime.nullable(),
    // How the figures are known; a figure is never a bill.
    basis: EnergyBasis,
    usedPercent: Percent,
    observedAt: IsoTime.nullable(),
    stale: z.boolean(),
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
  resources: z.array(EnergyResource),
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
export type EnergyAdminView = z.infer<typeof EnergyAdminView>;

export const energySchemas = {
  'energy.view.v1': EnergyView,
  'energy.admin-view.v1': EnergyAdminView,
  'energy.limits.v1': EnergyLimits,
  'energy.preference.v1': EnergyPreferenceUpdate,
} satisfies Record<string, z.ZodType>;
