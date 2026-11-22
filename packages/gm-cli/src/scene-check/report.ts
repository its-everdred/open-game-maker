import { coherentBuildings } from './buildings.js';
import { facing } from './facing.js';
import { framing, type MockMeasure } from './framing.js';
import { Grid } from './grid.js';
import { CHECK_ORDER, type Camera, type Finding, type Scene, type Severity } from './model.js';
import { noOverlap } from './overlap.js';
import { naturalPlacement } from './placement.js';
import { connectedRuns, unmeasured } from './runs.js';
import { traversable } from './traverse.js';

export interface CheckOptions {
  camera: Camera;
  minDensity: number;
  mock?: MockMeasure;
  /** Finding or check ids the worker lists as known limitations; they stay in the report but do not fail it. */
  allow: readonly string[];
}

export interface SceneReport {
  scene: string;
  pass: boolean;
  counts: Record<Severity, number>;
  findings: (Finding & { rank: number; known: boolean })[];
}

const SEVERITY: readonly Severity[] = ['high', 'medium', 'low', 'info'];

/** Run every structural check and rank the findings worst first: severity, then check order, then size. */
export function checkScene(name: string, scene: Scene, options: CheckOptions): SceneReport {
  const grid = new Grid(scene);
  const all = [
    ...connectedRuns(grid),
    ...coherentBuildings(grid),
    ...noOverlap(grid),
    ...facing(grid),
    ...traversable(grid),
    ...naturalPlacement(grid, options),
    ...(options.mock ? framing(grid, options.camera, options.mock) : []),
    ...unmeasured(grid),
    ...scene.notes,
  ];
  all.sort(
    (a, b) =>
      SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity) ||
      CHECK_ORDER.indexOf(a.check) - CHECK_ORDER.indexOf(b.check) ||
      b.cells.length - a.cells.length,
  );
  const allow = new Set(options.allow);
  const findings = all.map((finding, i) => ({
    ...finding,
    rank: i + 1,
    known: allow.has(finding.id) || allow.has(finding.check),
  }));
  const counts = Object.fromEntries(SEVERITY.map((s) => [s, all.filter((f) => f.severity === s).length])) as Record<
    Severity,
    number
  >;
  return { scene: name, pass: !findings.some((f) => f.severity === 'high' && !f.known), counts, findings };
}

/** The ranked list as markdown, for a ticket comment or a review's known limitations. */
export function reportMarkdown(report: SceneReport): string {
  const { high, medium, low, info } = report.counts;
  const lines = [
    `### Scene structure: ${report.scene} — ${report.pass ? 'pass' : 'FAIL'}`,
    '',
    `${high} high, ${medium} medium, ${low} low, ${info} info. Fix from the top.`,
    '',
  ];
  if (report.findings.length) {
    lines.push('| # | Severity | Check | Finding | Cells |', '|---|---|---|---|---|');
    for (const f of report.findings) {
      const cells =
        f.cells
          .slice(0, 6)
          .map((c) => `(${c.x},${c.y})`)
          .join(' ') + (f.cells.length > 6 ? ' …' : '');
      const severity = f.known ? `${f.severity} (known limitation)` : f.severity;
      lines.push(`| ${f.rank} | ${severity} | \`${f.id}\` | ${f.message.replace(/\|/g, '\\|')} | ${cells} |`);
    }
  }
  return lines.join('\n') + '\n';
}
