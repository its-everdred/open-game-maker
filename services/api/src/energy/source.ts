import type { EnergyLimits, EnergyResource, EnergyWindowName } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, gte, lte } from 'drizzle-orm';

import { netCharges } from '../budget/allowance.js';
import { dayKey, nextReset } from '../budget/reset.js';
import type { ProviderReading, ProviderReadings } from './providers.js';
import { readLimits } from './store.js';

// What a resource-policy source knows at one instant. Usage is in micro-dollars; null means unknown, never zero.
export type EnergySnapshot = {
  limits: EnergyLimits;
  usage: Record<EnergyWindowName, number> & { voice: number | null; images: number | null };
  resetsAt: Record<EnergyWindowName, string>;
  resources: EnergyResource[];
  // Provider readings (#1217): subscription windows, the fal ledger and ElevenLabs.
  readings: ProviderReading[];
};

// Where Energy comes from. The local source below is the first implementation; Aiur's resource-policy view
// (requested through Khala, 2026-11-08) replaces it without changing the routes, the admission check or the UI.
export interface ResourcePolicySource {
  snapshot(now: Date): EnergySnapshot;
}

// What Game Maker already knows: its own build ledger and the limits an admin entered, plus the provider readings
// fetched ahead of the snapshot. It does not meter voice or images in dollars, so those stay unknown.
export function localSource(deps: EnergySourceDeps): ResourcePolicySource {
  return {
    snapshot(now) {
      const today = dayKey(now, deps.zone);
      const usage = ledgerUsage(deps.db, now, deps.zone);
      return {
        limits: readLimits(deps.db),
        usage: { ...usage, voice: null, images: null },
        resetsAt: {
          day: nextReset(now, deps.zone).toISOString(),
          week: startOfDay(addDays(weekStart(today), 7), now, deps.zone),
          month: startOfDay(nextMonthStart(today), now, deps.zone),
        },
        resources: [
          {
            label: 'Builds',
            provider: 'aiur',
            kind: 'metered',
            spentMicroUsd: usage.month,
            remainingMicroUsd: null,
            resetsAt: null,
            basis: 'estimate',
            usedPercent: null,
            observedAt: null,
            stale: false,
          },
          ...(deps.readings ?? []).map((reading): EnergyResource => ({
            label: reading.label,
            provider: reading.provider,
            kind: reading.kind,
            spentMicroUsd: reading.spentMicroUsd,
            remainingMicroUsd:
              reading.capMicroUsd === null || reading.spentMicroUsd === null
                ? null
                : Math.max(0, reading.capMicroUsd - reading.spentMicroUsd),
            resetsAt: reading.resetsAt,
            basis: reading.basis,
            usedPercent: reading.usedPercent,
            observedAt: reading.observedAt,
            stale: reading.stale,
          })),
        ],
        readings: deps.readings ?? [],
      };
    },
  };
}

type Windows = { day: string; week: string; weekEnd: string; month: string };

function windowsAt(now: Date, zone: string): Windows {
  const today = dayKey(now, zone);
  return { day: today, week: weekStart(today), weekEnd: addDays(weekStart(today), 7), month: today.slice(0, 7) };
}

// Ledger day keys are written in each family's reset zone, so each row is placed by its own family's calendar. Whole
// windows count, including reservations already made for a later day of the same week or month (a queued build).
function ledgerUsage(db: Db, now: Date, zone: string): Record<EnergyWindowName, number> {
  const zones = new Map(
    db
      .select({ familyId: schema.familyBudgetSettings.familyId, zone: schema.familyBudgetSettings.resetZone })
      .from(schema.familyBudgetSettings)
      .all()
      .map((row) => [row.familyId, row.zone]),
  );
  const instance = windowsAt(now, zone);
  const from = addDays([instance.week, `${instance.month}-01`].sort()[0]!, -2);
  const to = addDays([instance.weekEnd, nextMonthStart(instance.day)].sort()[1]!, 2);
  const rows = db
    .select()
    .from(schema.budgetLedger)
    .where(and(gte(schema.budgetLedger.dayKey, from), lte(schema.budgetLedger.dayKey, to)))
    .all();
  const byZone = new Map<string, Windows>();
  const windowsFor = (familyZone: string) => {
    const cached = byZone.get(familyZone) ?? windowsAt(now, familyZone);
    byZone.set(familyZone, cached);
    return cached;
  };
  const placed = rows.map((row) => ({ row, windows: windowsFor(zones.get(row.familyId) ?? zone) }));
  const sum = (inWindow: (key: string, windows: Windows) => boolean) =>
    netCharges(placed.filter(({ row, windows }) => inWindow(row.dayKey, windows)).map(({ row }) => row));
  return {
    day: sum((key, w) => key === w.day),
    week: sum((key, w) => key >= w.week && key < w.weekEnd),
    month: sum((key, w) => key.startsWith(`${w.month}-`)),
  };
}

export type EnergySourceDeps = { db: Db; zone: string; readings?: ProviderReading[] };

// The snapshot the routes and job bundles show: provider readings (cached, time-boxed) fetched first.
export async function readEnergySnapshot(
  deps: { db: Db; zone: string; readings: ProviderReadings | null },
  now: Date,
): Promise<EnergySnapshot> {
  const readings = (await deps.readings?.read(now)) ?? [];
  return energySource({ db: deps.db, zone: deps.zone, readings }).snapshot(now);
}

// The single place the routes and admission get their source; swap it for Aiur's view here.
export function energySource(deps: EnergySourceDeps): ResourcePolicySource {
  return localSource(deps);
}

// Day keys are YYYY-MM-DD in the instance's reset zone; weeks start on Monday.
function addDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekStart(key: string): string {
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
  return addDays(key, -((weekday + 6) % 7));
}

function nextMonthStart(key: string): string {
  const date = new Date(`${key.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

// The instant `key` begins in `zone`, stepping day boundary to day boundary from `now` (at most ~31 steps).
function startOfDay(key: string, now: Date, zone: string): string {
  let boundary = nextReset(now, zone);
  while (dayKey(boundary, zone) < key) boundary = nextReset(new Date(boundary.getTime() + 22 * 3_600_000), zone);
  return boundary.toISOString();
}
