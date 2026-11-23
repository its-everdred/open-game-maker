import type { EnergyCap, EnergyLimits, EnergyResource, EnergyWindowName } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, gte, lte } from 'drizzle-orm';

import { netCharges } from '../budget/allowance.js';
import { dayKey, nextReset } from '../budget/reset.js';
import { netlifyDeploysSince } from './netlify.js';
import type { ProviderReading, ProviderReadings } from './providers.js';
import { energyCaps, energyResources, type EnergyCaps } from './resources.js';
import { recordSamples } from './samples.js';
import { readCaps, readLimits } from './store.js';

// What a resource-policy source knows at one instant. Usage is in micro-dollars; null means unknown, never zero.
export type EnergySnapshot = {
  limits: EnergyLimits;
  usage: Record<EnergyWindowName, number> & { voice: number | null; images: number | null };
  resetsAt: Record<EnergyWindowName, string>;
  // The admin's per-resource view (#1219), never summed across kinds.
  resources: EnergyResource[];
  caps: EnergyCap[];
  capValues: EnergyCaps;
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
      const limits = readLimits(deps.db);
      const readings = deps.readings ?? [];
      const capValues = readCaps(deps.db);
      const resetsAt = {
        day: nextReset(now, deps.zone).toISOString(),
        week: startOfDay(addDays(weekStart(today), 7), now, deps.zone),
        month: startOfDay(nextMonthStart(today), now, deps.zone),
      };
      const falCapMicroUsd = readings.find((reading) => reading.provider === 'fal')?.capMicroUsd ?? null;
      return {
        limits,
        usage: { ...usage, voice: null, images: null },
        resetsAt,
        resources: energyResources({
          limits,
          usage,
          resetsAt,
          readings,
          caps: capValues,
          falCapMicroUsd,
          netlifyDeploys: deps.netlifyLog ? netlifyDeploysSince(deps.netlifyLog, monthBefore(resetsAt.month)) : null,
          now,
        }),
        caps: energyCaps(capValues, falCapMicroUsd),
        capValues,
        readings,
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

export type EnergySourceDeps = { db: Db; zone: string; readings?: ProviderReading[]; netlifyLog?: string | null };

// The snapshot the routes and job bundles show: provider readings (cached, time-boxed) fetched first.
export async function readEnergySnapshot(
  deps: { db: Db; zone: string; readings: ProviderReadings | null; netlifyLog?: string | null },
  now: Date,
): Promise<EnergySnapshot> {
  const readings = (await deps.readings?.read(now)) ?? [];
  const snapshot = energySource({ db: deps.db, zone: deps.zone, readings, netlifyLog: deps.netlifyLog }).snapshot(now);
  recordSamples(deps.db, snapshot.resources, now);
  return snapshot;
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

// This month's start: a calendar month before its reset (within an hour across a DST change; Netlify is an estimate).
function monthBefore(reset: string): Date {
  const date = new Date(reset);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date;
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
