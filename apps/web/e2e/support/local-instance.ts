import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A disposable instance repository for system tests; never points at a hosted remote. */
export function createLocalInstance() {
  const root = mkdtempSync(join(tmpdir(), 'ogm-new-game-system-'));
  const bare = join(root, 'instance.git');
  const checkout = join(root, 'checkout');
  try {
    execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' });
    execFileSync('git', ['clone', '--quiet', bare, checkout], { stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-C',
        checkout,
        '-c',
        'user.name=System Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '--allow-empty',
        '-m',
        'Initialize',
      ],
      { stdio: 'ignore' },
    );
    execFileSync('git', ['-C', checkout, 'push', '--quiet', 'origin', 'main'], { stdio: 'ignore' });
    return { root, bare, checkout, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
