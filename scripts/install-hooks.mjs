import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
if (execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim() !== '.githooks') {
  throw new Error('Git did not configure .githooks as the hooks path');
}
accessSync('.githooks/pre-commit', constants.X_OK);
