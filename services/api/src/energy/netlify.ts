import { readFileSync } from 'node:fs';

// A production deploy costs 15 Netlify credits (Netlify's credit pricing, 2026-11); bandwidth, compute and requests
// cost more and are not counted, so the total is an estimate and a floor.
export const NETLIFY_CREDITS_PER_DEPLOY = 15;

// `apps/web/tools/deploy.sh` appends one ISO time per production deploy. No log means none recorded yet: unknown,
// since deploys before the log existed are not in it.
export function netlifyDeploysSince(path: string, since: Date): number | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  return text.split('\n').filter((line) => {
    const at = Date.parse(line.trim());
    return !Number.isNaN(at) && at >= since.getTime();
  }).length;
}
