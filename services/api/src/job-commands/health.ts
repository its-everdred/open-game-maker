import type { AppDeps } from '../app/types.js';

const missingSupervisorTokens = new WeakMap<AppDeps, Set<string>>();

function missingFor(deps: AppDeps): Set<string> {
  let missing = missingSupervisorTokens.get(deps);
  if (missing === undefined) {
    missing = new Set();
    missingSupervisorTokens.set(deps, missing);
  }
  return missing;
}

export function recordSupervisorTokenStatus(deps: AppDeps, daemon: string, missing: boolean): void {
  if (missing) missingFor(deps).add(daemon);
  else missingFor(deps).delete(daemon);
}

export function commandHealthDetails(deps: AppDeps) {
  const daemons = [...missingFor(deps)].sort();
  return { ok: daemons.length === 0, missing_supervisor_token_daemons: daemons };
}
