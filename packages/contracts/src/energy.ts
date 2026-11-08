import { z } from 'zod';

import { IsoTime, MicroUsd } from './api.js';

// Energy (#598): one pool per hosted instance. Players see status and percentages; admins also see costs and providers.
// Mixed resources are never converted into one number: the status is the tightest known limit, else unknown.
export const EnergyPreference = z.enum(['save', 'balanced', 'best']);
export const EnergyWindowName = z.enum(['day', 'week', 'month']);
export const EnergyServiceName = z.enum(['voice', 'images']);
export const EnergyLevel = z.enum(['healthy', 'limited', 'critical', 'unknown']);
export const EnergyResourceKind = z.enum(['subscription', 'prepaid', 'metered']);

// null = no limit set, or usage unknown: shown as unknown, never as full or empty.
const Percent = z.number().min(0).max(100).nullable();

export const EnergyView = z
  .object({
    level: EnergyLevel,
    preference: EnergyPreference,
    windows: z.array(z.object({ window: EnergyWindowName, usedPercent: Percent, resetsAt: IsoTime }).strict()),
    services: z.array(z.object({ service: EnergyServiceName, usedPercent: Percent }).strict()),
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
    // Spend this month as recorded by Game Maker; null when not recorded here.
    spentMicroUsd: MicroUsd.nullable(),
    // Remaining capacity at the provider; null when unknown (the local source never knows it).
    remainingMicroUsd: MicroUsd.nullable(),
    // A subscription's next reset; prepaid credits and metered spend have none.
    resetsAt: IsoTime.nullable(),
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
