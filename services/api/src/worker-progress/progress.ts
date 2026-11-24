export type WorkerProgress = {
  percent: number | null;
  etaSeconds: number | null;
  source: 'daemon' | 'workpad' | 'unknown';
};

// Progress check-ins are an agent's estimate of its phase, not a rate from which a remaining duration can be
// calculated. Without one, the ticket's workpad checklist (done of total) stands in (Kevin, #1326); with neither the
// reading remains unknown.
export function workerProgress(input: { percent?: number; runtimeSeconds: number; workpad?: string }): WorkerProgress {
  const percent = input.percent;
  if (percent !== undefined && Number.isFinite(percent) && percent >= 0 && percent <= 100) {
    return { percent: Math.round(percent), etaSeconds: null, source: 'daemon' };
  }
  const checklist = checklistPercent(input.workpad);
  if (checklist !== undefined) return { percent: checklist, etaSeconds: null, source: 'workpad' };
  return { percent: null, etaSeconds: null, source: 'unknown' };
}

// Markdown task items (`- [x]`, `* [ ]`) anywhere in the workpad; undefined when it has none.
export function checklistPercent(workpad: string | undefined): number | undefined {
  const boxes = workpad?.match(/^\s*[-*+] \[[ xX]\]/gm) ?? [];
  if (boxes.length === 0) return undefined;
  const done = boxes.filter((box) => /\[[xX]\]$/.test(box)).length;
  return Math.round((done * 100) / boxes.length);
}
