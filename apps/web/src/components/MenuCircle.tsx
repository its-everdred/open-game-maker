// The studio menu's circle: an icon inside a ring. `percent` fills the ring (energy left, build progress, volume);
// without it the ring is only its track.
export function MenuRing({ percent }: { percent?: number }) {
  return (
    <svg className="menu-circle-ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="16" pathLength={100} />
      {percent === undefined ? null : (
        <circle cx="18" cy="18" r="16" pathLength={100} strokeDasharray={`${clampPercent(percent)} 100`} />
      )}
    </svg>
  );
}

function clampPercent(percent: number): number {
  return Math.round(Math.min(100, Math.max(0, percent)));
}
