import { useState } from 'react';

import type { EnergyAdminView, EnergyLimits, EnergyPreference } from '@ogm/contracts/browser';

import { useAdminMe } from '../../routes/admin/api';
import { parseUnits } from '../../routes/admin/Budgets';
import { requireAdmin } from '../../routes/admin/guard';
import { useEnergy, useEnergyAdmin, useSaveLimits, useSetPreference, WINDOW_LABELS } from './api';
import { EnergyWindows, LEVEL_LABELS } from './EnergyWindows';
import './energy.css';

const PREFERENCES: { value: EnergyPreference; label: string }[] = [
  { value: 'save', label: 'Save Energy' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'best', label: 'Best Quality' },
];
const LIMIT_LABELS: Record<keyof EnergyLimits, string> = { ...WINDOW_LABELS, voice: 'Voice', images: 'Images' };
const LIMIT_KEYS = Object.keys(LIMIT_LABELS) as (keyof EnergyLimits)[];
const MICRO_PER_USD = 1_000_000;

const usd = (micro: number | null) => (micro === null ? 'Unknown' : `$${(micro / MICRO_PER_USD).toFixed(2)}`);

// Blank means no limit; anything else must be a dollar amount.
export function parseLimits(text: Record<keyof EnergyLimits, string>): EnergyLimits | null {
  const limits = {} as EnergyLimits;
  for (const key of LIMIT_KEYS) {
    if (text[key].trim() === '') {
      limits[key] = null;
      continue;
    }
    const micro = parseUnits(text[key], MICRO_PER_USD);
    if (micro === null) return null;
    limits[key] = micro;
  }
  return limits;
}

export function EnergyScreen() {
  const energy = useEnergy();
  const me = useAdminMe();
  const isAdmin = requireAdmin(me.data ?? null) === 'ok';
  const admin = useEnergyAdmin(isAdmin);
  const setPreference = useSetPreference();

  if (energy.isPending) return <p>Loading…</p>;
  if (energy.isError) return <p role="alert">Unavailable</p>;
  const view = energy.data;

  return (
    <section className="energy-screen">
      <h2>Energy: {LEVEL_LABELS[view.level]}</h2>
      <EnergyWindows view={view} services />
      <fieldset aria-label="Energy preference" disabled={setPreference.isPending}>
        {PREFERENCES.map(({ value, label }) => (
          <label key={value}>
            <input
              type="radio"
              name="energy-preference"
              value={value}
              checked={view.preference === value}
              onChange={() => setPreference.mutate(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {admin.data ? <AdminEnergy view={admin.data} /> : null}
    </section>
  );
}

function AdminEnergy({ view }: { view: EnergyAdminView }) {
  const saveLimits = useSaveLimits();
  const [text, setText] = useState(
    () =>
      Object.fromEntries(
        LIMIT_KEYS.map((key) => [key, view.limits[key] === null ? '' : String(view.limits[key] / MICRO_PER_USD)]),
      ) as Record<keyof EnergyLimits, string>,
  );
  const limits = parseLimits(text);

  return (
    <>
      <form
        aria-label="Energy limits"
        onSubmit={(event) => {
          event.preventDefault();
          if (limits) saveLimits.mutate(limits);
        }}
      >
        <div className="energy-limits">
          {LIMIT_KEYS.map((key) => (
            <label key={key}>
              {LIMIT_LABELS[key]} ($)
              <input
                inputMode="decimal"
                value={text[key]}
                aria-invalid={text[key].trim() !== '' && parseUnits(text[key], MICRO_PER_USD) === null}
                onChange={(event) => setText((current) => ({ ...current, [key]: event.target.value }))}
              />
              <small>{usd(view.usage[key])} used</small>
            </label>
          ))}
        </div>
        <button className="tap-primary" type="submit" disabled={!limits || saveLimits.isPending}>
          Save
        </button>
      </form>
      <table aria-label="Energy resources">
        <thead>
          <tr>
            <th>Resource</th>
            <th>Provider</th>
            <th>Kind</th>
            <th>Spent this month</th>
            <th>Remaining</th>
          </tr>
        </thead>
        <tbody>
          {view.resources.map((resource) => (
            <tr key={`${resource.provider}:${resource.label}`}>
              <td>{resource.label}</td>
              <td>{resource.provider}</td>
              <td>{resource.kind}</td>
              <td>{usd(resource.spentMicroUsd)}</td>
              <td>{usd(resource.remainingMicroUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
