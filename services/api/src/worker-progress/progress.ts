export type WorkerProgress = {
  percent: number | null;
  etaSeconds: number | null;
  source: 'daemon' | 'workpad' | 'unknown';
};

// A missing reading stays unknown: zero completed items is not an estimate of a finish time.
export function workerProgress(input: { percent?: number; runtimeSeconds: number; workpad?: string }): WorkerProgress {
  let percent: number | null = null;
  let source: WorkerProgress['source'] = 'unknown';
  if (input.percent !== undefined && Number.isFinite(input.percent) && input.percent >= 0 && input.percent <= 100) {
    percent = Math.round(input.percent);
    source = 'daemon';
  } else {
    const checks = [...(input.workpad ?? '').matchAll(/^\s*[-*] \[([ xX])\]/gm)];
    if (checks.length > 0) {
      percent = Math.round((checks.filter((check) => check[1]?.toLowerCase() === 'x').length / checks.length) * 100);
      source = 'workpad';
    }
  }
  const elapsed = input.runtimeSeconds;
  const etaSeconds =
    percent !== null && percent > 0 && Number.isFinite(elapsed) && (elapsed > 0 || percent === 100)
      ? Math.ceil((elapsed * (100 - percent)) / percent)
      : null;
  return { percent, etaSeconds, source };
}
