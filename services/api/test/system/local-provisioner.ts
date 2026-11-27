import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

import { gameFolder } from '@ogm/contracts';
import { renderRepoTemplate } from '@ogm/game-repo-template';

import type { RepoProvisioner } from '../../src/app/registry.js';

/** Test-only substitute for the GitHub-backed commit service, writing a real template to a local checkout. */
export function localProvisioner(checkout: string): RepoProvisioner {
  return {
    async provision(game) {
      const folder = gameFolder(game.slug);
      const gameRoot = resolve(checkout, folder);
      const template = renderRepoTemplate('game-2d@1', {
        gameId: game.id,
        owner: 'instance',
        visibility: game.visibility,
      });
      for (const file of template.files) {
        if (file.path === '.github' || file.path.startsWith('.github/')) continue;
        const destination = resolve(gameRoot, file.path);
        if (!destination.startsWith(gameRoot + sep) || file.mode === '120000') throw new Error('unsafe template path');
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, file.content);
        if (file.mode === '100755') chmodSync(destination, 0o755);
      }
      execFileSync('git', ['-C', checkout, 'add', '--', folder]);
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
          '-m',
          'Create game',
        ],
        { stdio: 'ignore' },
      );
      execFileSync('git', ['-C', checkout, 'push', '--quiet', 'origin', 'main']);
      return { owner: 'instance', repo: 'games', url: 'https://github.com/instance/games', path: folder };
    },
  };
}
