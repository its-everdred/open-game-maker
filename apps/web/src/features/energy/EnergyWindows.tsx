import type { EnergyLevel, EnergyView } from '@ogm/contracts/browser';

import { WINDOW_LABELS } from './api';

export const LEVEL_LABELS: Record<EnergyLevel, string> = {
  healthy: 'Healthy',
  limited: 'Limited',
  critical: 'Critical',
  unknown: 'Unknown',
};

const SERVICE_LABELS = { voice: 'Voice', images: 'Images' } as const;

function Meter({ label, usedPercent }: { label: string; usedPercent: number | null }) {
  return (
    <li className="energy-meter" data-known={usedPercent !== null}>
      <span>{label}</span>
      <span>{usedPercent === null ? 'Unknown' : `${100 - usedPercent}% left`}</span>
      <span className="energy-meter-bar" aria-hidden="true">
        <span style={{ width: `${usedPercent === null ? 0 : 100 - usedPercent}%` }} />
      </span>
    </li>
  );
}

// Daily, weekly and monthly windows; per-service lines only where `services` is asked for (the settings breakdown).
export function EnergyWindows({ view, services = false }: { view: EnergyView; services?: boolean }) {
  return (
    <ul className="energy-windows" data-level={view.level}>
      {view.windows.map(({ window, usedPercent }) => (
        <Meter key={window} label={WINDOW_LABELS[window]} usedPercent={usedPercent} />
      ))}
      {services
        ? view.services.map(({ service, usedPercent }) => (
            <Meter key={service} label={SERVICE_LABELS[service]} usedPercent={usedPercent} />
          ))
        : null}
    </ul>
  );
}
