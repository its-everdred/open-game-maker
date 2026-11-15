export type WorkerProgress = {
  percent: number | null;
  etaSeconds: number | null;
  source: 'daemon' | 'unknown';
};

// Progress check-ins are an agent's estimate of its phase, not a rate from which
// a remaining duration can be calculated. An absent reading remains unknown.
export function workerProgress(input: { percent?: number; runtimeSeconds: number; workpad?: string }): WorkerProgress {
  const percent = input.percent;
  if (percent !== undefined && Number.isFinite(percent) && percent >= 0 && percent <= 100) {
    return { percent: Math.round(percent), etaSeconds: null, source: 'daemon' };
  }
  return { percent: null, etaSeconds: null, source: 'unknown' };
}
