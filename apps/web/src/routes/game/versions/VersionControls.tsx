import { useNavigate } from 'react-router';

import type { GameExtraProps } from '../extras';

export function VersionControls({ gameId, branchId, mode, onNavigate }: GameExtraProps) {
  const navigate = useNavigate();
  const query = `?v=${encodeURIComponent(branchId)}`;
  if (mode === 'edit') return null;

  return (
    <div className="version-controls" role="group" aria-label="Versions and releases">
      <button
        className="tap-secondary"
        type="button"
        aria-label="Versions"
        onClick={() => {
          onNavigate?.();
          void navigate(`/g/${encodeURIComponent(gameId)}/versions${query}`);
        }}
      >
        <span aria-hidden="true">⑂</span>
      </button>
      <button
        className="tap-secondary"
        type="button"
        aria-label="Releases"
        onClick={() => {
          onNavigate?.();
          void navigate(`/g/${encodeURIComponent(gameId)}/releases${query}`);
        }}
      >
        <span aria-hidden="true">★</span>
      </button>
    </div>
  );
}
