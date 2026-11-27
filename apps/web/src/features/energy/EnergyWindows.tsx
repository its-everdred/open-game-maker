import type { EnergyLevel, EnergySource, EnergyView } from '@ogm/contracts/browser';

import { WINDOW_LABELS } from './api';

export const LEVEL_LABELS: Record<EnergyLevel, string> = {
  healthy: 'Healthy',
  limited: 'Limited',
  critical: 'Critical',
  unknown: 'Unknown',
};

const SERVICE_LABELS = { voice: 'Voice', images: 'Images' } as const;

function Meter({
  label,
  usedPercent,
  note,
  unlimited = false,
}: {
  label: string;
  usedPercent: number | null;
  note?: string;
  unlimited?: boolean;
}) {
  return (
    <li className="energy-meter" data-known={usedPercent !== null}>
      <span>{label}</span>
      <span>{unlimited ? 'Unlimited' : usedPercent === null ? 'Unknown' : `${100 - usedPercent}% left`}</span>
      <span className="energy-meter-bar" aria-hidden="true">
        <span style={{ width: `${usedPercent === null ? 0 : 100 - usedPercent}%` }} />
      </span>
      {note ? <small className="energy-meter-note">{note}</small> : null}
    </li>
  );
}

const HOUR_MS = 3_600_000;

function age(observedAt: string, now: number): string {
  const hours = Math.max(0, Math.floor((now - Date.parse(observedAt)) / HOUR_MS));
  return hours < 48 ? `${hours} h old` : `${Math.floor(hours / 24)} d old`;
}

// The reset, how the reading is known, and its age when it is too old to count.
export function sourceNote(source: EnergySource, now = Date.now()): string {
  const parts: string[] = [];
  if (source.resetsAt) {
    const day = new Date(source.resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    parts.push(`resets ${day}`);
  }
  parts.push(source.basis);
  if (source.stale && source.observedAt) parts.push(age(source.observedAt, now));
  return parts.join(' · ');
}

// Daily, weekly and monthly windows, then one line per provider reading; per-service lines only where `services` is
// asked for (the settings breakdown).
export function EnergyWindows({ view, services = false }: { view: EnergyView; services?: boolean }) {
  return (
    <ul className="energy-windows" data-level={view.level}>
      {view.weeklyJobs
        ? (['newGames', 'edits'] as const).map((kind) => {
            const bucket = view.weeklyJobs![kind];
            const used =
              bucket.limit === null || bucket.remaining === null
                ? null
                : bucket.limit === 0
                  ? 100
                  : Math.round(100 * (1 - bucket.remaining / bucket.limit));
            const reset = new Date(view.weeklyJobs!.resetsAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
            return (
              <Meter
                key={kind}
                label={kind === 'newGames' ? 'New games this week' : 'Edits this week'}
                usedPercent={used}
                unlimited={bucket.limit === null}
                note={
                  bucket.limit === null ? undefined : `${bucket.remaining} of ${bucket.limit} left · resets ${reset}`
                }
              />
            );
          })
        : null}
      {view.windows.map(({ window, usedPercent }) => (
        <Meter key={window} label={WINDOW_LABELS[window]} usedPercent={usedPercent} />
      ))}
      {services
        ? view.services.map(({ service, usedPercent }) => (
            <Meter key={service} label={SERVICE_LABELS[service]} usedPercent={usedPercent} />
          ))
        : null}
      {/* An API from before #1217 sends no sources. */}
      {(view.sources ?? []).map((source) => (
        <Meter key={source.id} label={source.label} usedPercent={source.usedPercent} note={sourceNote(source)} />
      ))}
    </ul>
  );
}
