import { useState } from 'react';

import type {
  EnergyAdminView,
  EnergyCap,
  EnergyCapsUpdate,
  EnergyLimits,
  EnergyResource,
} from '@ogm/contracts/browser';

import { parseUnits } from '../../routes/admin/Budgets';
import { useEnergyAdmin, useSaveCaps, useSaveLimits, WINDOW_LABELS } from './api';
import { EnergyHistory } from './EnergyHistory';
import { LEVEL_LABELS } from './EnergyWindows';
import './energy.css';

const LIMIT_LABELS: Record<keyof EnergyLimits, string> = { ...WINDOW_LABELS, voice: 'Voice', images: 'Images' };
const LIMIT_KEYS = Object.keys(LIMIT_LABELS) as (keyof EnergyLimits)[];
const MICRO_PER_USD = 1_000_000;
const MINUTE_MS = 60_000;

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

// An amount in its unit; null is Unknown, never 0.
export function amount(value: number | null, unit: EnergyResource['unit']): string {
  if (value === null) return 'Unknown';
  if (unit === 'usd') return `$${value.toFixed(2)}`;
  if (unit === 'percent') return `${Math.round(value)}%`;
  return value.toLocaleString('en-US');
}

// How a figure is known. An estimate shows its range when it has one and always says "estimate".
export function basisText(resource: Pick<EnergyResource, 'basis' | 'range' | 'unit'>): string {
  if (resource.basis !== 'estimate' || !resource.range) return resource.basis;
  return `estimate ${amount(resource.range.low, resource.unit)}–${amount(resource.range.high, resource.unit)}`;
}

export function ageText(ageMs: number | null): string {
  if (ageMs === null) return '';
  const minutes = Math.floor(ageMs / MINUTE_MS);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

export function EnergyAdmin() {
  const admin = useEnergyAdmin(true);
  if (admin.isPending) return <p className="admin-state">Loading…</p>;
  if (admin.isError) return <p className="admin-state">Not allowed</p>;
  return <EnergyDashboard view={admin.data} />;
}

function EnergyDashboard({ view }: { view: EnergyAdminView }) {
  const { binding } = view.pool;
  return (
    <section className="energy-admin">
      <h2>Energy: {LEVEL_LABELS[view.level]}</h2>
      {binding ? (
        <p className="energy-binding">
          {binding.label} · {binding.leftPercent}% left{binding.resetsAt ? ` · resets ${day(binding.resetsAt)}` : ''}
        </p>
      ) : null}
      <Resources resources={view.resources} />
      {view.subscriptions.length > 0 ? <Subscriptions view={view} /> : null}
      <EnergyHistory resources={view.resources} history={view.history} />
      <Limits view={view} />
      <Caps caps={view.caps} />
    </section>
  );
}

function Resources({ resources }: { resources: EnergyResource[] }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table energy-resources" aria-label="Energy resources">
        <thead>
          <tr>
            <th scope="col">Resource</th>
            <th scope="col">Used</th>
            <th scope="col">Limit</th>
            <th scope="col">Left</th>
            <th scope="col">Resets</th>
            <th scope="col">Basis</th>
            <th scope="col">Age</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((resource) => (
            <tr key={resource.id} data-state={resource.state} data-freshness={resource.freshness}>
              <th scope="row">{resource.label}</th>
              <td>{amount(resource.used, resource.unit)}</td>
              {/* A window's limit is always 100 %; only a real limit is shown. */}
              <td>
                {resource.unit === 'percent'
                  ? ''
                  : resource.limit === null
                    ? '–'
                    : amount(resource.limit, resource.unit)}
              </td>
              <td>{resource.limit === null && resource.used !== null ? '–' : amount(resource.left, resource.unit)}</td>
              <td>{day(resource.resetsAt)}</td>
              <td>{basisText(resource)}</td>
              <td>{resource.freshness === 'stale' ? `stale ${ageText(resource.ageMs)}` : ageText(resource.ageMs)}</td>
              <td>{resource.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Subscriptions({ view }: { view: EnergyAdminView }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table" aria-label="Subscription spend">
        <thead>
          <tr>
            <th scope="col">Plan</th>
            <th scope="col">A week</th>
            <th scope="col">Used this week</th>
            <th scope="col">Basis</th>
          </tr>
        </thead>
        <tbody>
          {view.subscriptions.map((plan) => (
            <tr key={plan.id}>
              <th scope="row">{plan.label}</th>
              <td>{amount(plan.weeklyUsd, 'usd')}</td>
              <td>
                {plan.usedUsd ? `${amount(plan.usedUsd.low, 'usd')}–${amount(plan.usedUsd.high, 'usd')}` : 'Unknown'}
              </td>
              <td>{plan.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Limits({ view }: { view: EnergyAdminView }) {
  const saveLimits = useSaveLimits();
  const [text, setText] = useState(
    () =>
      Object.fromEntries(
        LIMIT_KEYS.map((key) => [key, view.limits[key] === null ? '' : String(view.limits[key] / MICRO_PER_USD)]),
      ) as Record<keyof EnergyLimits, string>,
  );
  const limits = parseLimits(text);
  return (
    <form
      className="admin-card"
      aria-label="Energy limits"
      onSubmit={(event) => {
        event.preventDefault();
        if (limits) saveLimits.mutate(limits);
      }}
    >
      <div className="admin-settings-grid energy-limits">
        {LIMIT_KEYS.map((key) => (
          <label key={key}>
            {LIMIT_LABELS[key]} ($)
            <input
              inputMode="decimal"
              value={text[key]}
              aria-invalid={text[key].trim() !== '' && parseUnits(text[key], MICRO_PER_USD) === null}
              onChange={(event) => setText((current) => ({ ...current, [key]: event.target.value }))}
            />
            <small>{view.usage[key] === null ? 'Unknown' : amount(view.usage[key] / MICRO_PER_USD, 'usd')} used</small>
          </label>
        ))}
      </div>
      <button className="admin-primary tap-primary" type="submit" disabled={!limits || saveLimits.isPending}>
        Save
      </button>
    </form>
  );
}

const capUnit = (cap: EnergyCap) => (cap.unit === 'usd' ? ' ($)' : '');

// OGM's caps are inputs; a cap owned elsewhere is shown read-only with where it is set.
function Caps({ caps }: { caps: EnergyCap[] }) {
  const saveCaps = useSaveCaps();
  const editable = caps.filter((cap) => cap.editable);
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((cap) => [cap.id, cap.limit === null ? '' : String(cap.limit)])),
  );
  const parsed = Object.fromEntries(
    editable.map((cap) => {
      const value = (text[cap.id] ?? '').trim();
      return [cap.id, value === '' ? null : /^\d+(\.\d+)?$/.test(value) ? Number(value) : undefined];
    }),
  );
  const valid = Object.values(parsed).every((value) => value !== undefined);
  return (
    <form
      className="admin-card"
      aria-label="Energy caps"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) saveCaps.mutate(parsed as EnergyCapsUpdate);
      }}
    >
      <div className="admin-settings-grid">
        {caps.map((cap) =>
          cap.editable ? (
            <label key={cap.id}>
              {cap.label}
              {capUnit(cap)}
              <input
                inputMode="decimal"
                value={text[cap.id] ?? ''}
                aria-invalid={parsed[cap.id] === undefined}
                onChange={(event) => setText((current) => ({ ...current, [cap.id]: event.target.value }))}
              />
            </label>
          ) : (
            <label key={cap.id}>
              {cap.label}
              {capUnit(cap)}
              <input readOnly value={cap.limit === null ? '' : String(cap.limit)} />
              {cap.layer ? <small>{cap.layer}</small> : null}
            </label>
          ),
        )}
      </div>
      <button className="admin-primary tap-primary" type="submit" disabled={!valid || saveCaps.isPending}>
        Save
      </button>
    </form>
  );
}
