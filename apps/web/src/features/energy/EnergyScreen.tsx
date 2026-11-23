import type { EnergyPreference } from '@ogm/contracts/browser';

import { useEnergy, useSetPreference } from './api';
import { EnergyWindows, LEVEL_LABELS } from './EnergyWindows';
import './energy.css';

const PREFERENCES: { value: EnergyPreference; label: string }[] = [
  { value: 'save', label: 'Save Energy' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'best', label: 'Best Quality' },
];

export function EnergyScreen() {
  const energy = useEnergy();
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
    </section>
  );
}
