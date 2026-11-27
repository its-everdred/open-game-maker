import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

/** Use the event's exact base in shallow CI checkouts, or the local merge base. */
export function glassDiffBase(root, env = process.env) {
  if (!env.CI) return 'origin/main...HEAD';
  if (!env.GITHUB_EVENT_PATH) throw new Error('Glass checks require GITHUB_EVENT_PATH in CI');
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const sha = event.pull_request?.base?.sha ?? event.merge_group?.base_sha ?? event.before;
  if (!/^[0-9a-f]{40}$/.test(sha ?? '') || /^0+$/.test(sha))
    throw new Error('Glass checks require a valid event base SHA');
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, stdio: 'ignore' });
  } catch {
    execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', sha], { cwd: root, stdio: 'inherit' });
  }
  // CI checks out the synthetic merge result for PRs; comparing the exact
  // event base to HEAD also works when that result has only shallow parents.
  return `${sha}..HEAD`;
}
