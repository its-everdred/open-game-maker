import { useState } from 'react';

import type { EnergyAdminView, EnergyHistoryPoint, EnergyResource } from '@ogm/contracts/browser';

const DAY_MS = 86_400_000;
const WIDTH = 300;
const HEIGHT = 40;

type Kind = 'reported' | 'estimate';
export type Run = { kind: Kind; points: EnergyHistoryPoint[] };

// Consecutive known points of one basis. An unknown point (or a missing hour) ends a run, so it draws as a gap.
export function historyRuns(points: EnergyHistoryPoint[], gapMs = 2 * 3_600_000): Run[] {
  const runs: Run[] = [];
  let previous: EnergyHistoryPoint | null = null;
  for (const point of points) {
    const kind =
      point.left === null || point.basis === 'unknown' ? null : point.basis === 'estimate' ? 'estimate' : 'reported';
    const last = runs.at(-1);
    const joined =
      kind !== null &&
      last?.kind === kind &&
      previous !== null &&
      previous.left !== null &&
      Date.parse(point.at) - Date.parse(previous.at) <= gapMs;
    if (kind !== null) {
      if (joined) last.points.push(point);
      else runs.push({ kind, points: [point] });
    }
    previous = kind === null ? null : point;
  }
  return runs;
}

function Spark({ points, from, to }: { points: EnergyHistoryPoint[]; from: number; to: number }) {
  const x = (at: string) => ((Date.parse(at) - from) / (to - from)) * WIDTH;
  const y = (left: number) => HEIGHT - (left / 100) * HEIGHT;
  const line = (values: [string, number][]) =>
    values.map(([at, left]) => `${x(at).toFixed(1)},${y(left).toFixed(1)}`).join(' ');
  return (
    <svg className="energy-spark" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
      {historyRuns(points).map((run) => {
        const key = `${run.kind}-${run.points[0]!.at}`;
        const values = run.points.map((point): [string, number] => [point.at, point.left!]);
        const banded =
          run.kind === 'estimate' && run.points.every((point) => point.low !== null && point.high !== null);
        if (banded) {
          const band = [
            ...run.points.map((point): [string, number] => [point.at, point.high!]),
            ...run.points.map((point): [string, number] => [point.at, point.low!]).reverse(),
          ];
          return <polygon key={key} className="energy-spark-band" points={line(band)} />;
        }
        if (values.length === 1) {
          const [[at, left]] = values as [[string, number]];
          return <circle key={key} className={`energy-spark-${run.kind}`} cx={x(at)} cy={y(left)} r={2} />;
        }
        return <polyline key={key} className={`energy-spark-${run.kind}`} points={line(values)} />;
      })}
    </svg>
  );
}

// Percent left per resource over 7 or 30 days: reported as lines, estimates as bands (dashed without a range),
// unknown as gaps.
export function EnergyHistory({
  resources,
  history,
  now = Date.now(),
}: {
  resources: EnergyResource[];
  history: EnergyAdminView['history'];
  now?: number;
}) {
  const [days, setDays] = useState<7 | 30>(7);
  const from = now - days * DAY_MS;
  const rows = resources.flatMap((resource) => {
    const points = (history.find(({ id }) => id === resource.id)?.points ?? []).filter(
      (point) => Date.parse(point.at) >= from,
    );
    // A resource never known in the window has nothing to draw; the table already says Unknown.
    return points.some((point) => point.left !== null) ? [{ resource, points }] : [];
  });
  return (
    <div className="admin-card energy-history">
      <div className="admin-toggle-row" role="group" aria-label="History">
        {([7, 30] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="admin-secondary"
            aria-pressed={days === value}
            onClick={() => setDays(value)}
          >
            {value} d
          </button>
        ))}
      </div>
      <ul>
        {rows.map(({ resource, points }) => (
          <li key={resource.id}>
            <span>{resource.label}</span>
            <Spark points={points} from={from} to={now} />
          </li>
        ))}
      </ul>
    </div>
  );
}
