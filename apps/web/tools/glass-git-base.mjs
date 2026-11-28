import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

/** Use the event's exact base in shallow CI checkouts, or the local merge base. */
export function glassDiffBase(root, env = process.env) {
  if (!env.CI) return 'origin/main...HEAD';
  if (!env.GITHUB_EVENT_PATH) throw new Error('Glass checks require GITHUB_EVENT_PATH in CI');
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const sha = event.pull_request?.base?.sha ?? event.merge_group?.base_sha ?? event.before;
  const head = event.pull_request?.head?.sha ?? 'HEAD';
  if (!/^[0-9a-f]{40}$/.test(sha ?? '') || /^0+$/.test(sha))
    throw new Error('Glass checks require a valid event base SHA');
  if (head !== 'HEAD' && (!/^[0-9a-f]{40}$/.test(head) || /^0+$/.test(head)))
    throw new Error('Glass checks require a valid event head SHA');
  for (const commit of [sha, head]) {
    try {
      execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdio: 'ignore' });
    } catch {
      execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', commit], { cwd: root, stdio: 'inherit' });
    }
  }
  // A PR merge checkout can contain newer main commits than the event base.
  // Compare the two event commits so unrelated main changes are not selected.
  return `${sha}..${head}`;
}
