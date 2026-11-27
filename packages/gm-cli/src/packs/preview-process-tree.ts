import { readdirSync, readFileSync } from 'node:fs';

type Process = { pid: number; parent: number; start: string };

function readProcess(pid: number): Process | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const parent = Number(fields[1]);
    const start = fields[19];
    if (!Number.isInteger(parent) || !start) return undefined;
    return { pid, parent, start };
  } catch {
    return undefined; // The process may exit while the snapshot is read.
  }
}

/** Capture Chromium too: Playwright starts it in a separate process group. */
export function previewDescendants(root: number): Process[] {
  if (process.platform !== 'linux') return [];
  const processes = readdirSync('/proc')
    .filter((entry) => /^\d+$/.test(entry))
    .map((entry) => readProcess(Number(entry)))
    .filter((entry): entry is Process => entry !== undefined);
  const parents = new Set([root]);
  const result: Process[] = [];
  let previousSize = 0;
  while (parents.size !== previousSize) {
    previousSize = parents.size;
    for (const entry of processes) {
      if (parents.has(entry.parent) && !parents.has(entry.pid)) {
        parents.add(entry.pid);
        result.push(entry);
      }
    }
  }
  return result;
}

export function killPreviewDescendants(descendants: Process[]): void {
  let failure: unknown;
  for (const entry of descendants.reverse()) {
    // Avoid signaling an unrelated process if a PID was recycled after the snapshot.
    if (readProcess(entry.pid)?.start !== entry.start) continue;
    try {
      process.kill(entry.pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= error;
    }
  }
  if (failure) throw failure;
}
