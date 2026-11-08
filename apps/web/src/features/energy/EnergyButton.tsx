import { Link } from 'react-router';

import { Icon } from '../../components/Icon';
import { MenuRing } from '../../components/MenuCircle';
import { energyLeftPercent, useEnergy } from './api';
import { EnergyWindows, LEVEL_LABELS } from './EnergyWindows';
import './energy.css';

// The studio menu's Energy control: a ring of what's left in the tightest window.
export function EnergyButton({ open, onToggle }: { open: boolean; onToggle(): void }) {
  const energy = useEnergy();
  const left = energyLeftPercent(energy.data);
  const level = energy.data?.level ?? 'unknown';

  return (
    <button
      type="button"
      className="menu-circle energy-button"
      data-level={level}
      aria-label={`Energy: ${LEVEL_LABELS[level]}`}
      aria-expanded={open}
      aria-controls="energy-detail"
      onClick={onToggle}
    >
      <MenuRing percent={left ?? 0} />
      <Icon name="energy" />
    </button>
  );
}

// The day/week/month detail; it opens the Energy settings, where the breakdown and preference live.
export function EnergyDetail({ close }: { close(): void }) {
  const energy = useEnergy();
  if (!energy.data) return null;
  return (
    <Link
      id="energy-detail"
      className="energy-detail"
      aria-label="Energy settings"
      to="/settings/energy"
      onClick={close}
    >
      <EnergyWindows view={energy.data} />
    </Link>
  );
}
