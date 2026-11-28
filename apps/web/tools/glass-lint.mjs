import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import { glassComponentsRule } from './glass-eslint.mjs';
import { glassDiffBase } from './glass-git-base.mjs';
import { glassStylelintConfig } from './glass-stylelint.mjs';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(web, '../..');
const gitFiles = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const changed = [
  ...new Set([
    ...gitFiles(['diff', '--name-only', '-z', '--diff-filter=ACMR', glassDiffBase(root), '--', 'apps/web/src']),
    ...gitFiles(['diff', '--name-only', '-z', '--diff-filter=ACMR', 'HEAD', '--', 'apps/web/src']),
    ...gitFiles(['ls-files', '--others', '--exclude-standard', '-z', '--', 'apps/web/src']),
  ]),
]
  .map((file) => resolve(root, file))
  .filter(existsSync);
const source = changed.filter((file) => !/\.(?:test|spec)\.[^.]+$/.test(file));
const css = source.filter((file) => file.endsWith('.css') && relative(web, file) !== 'src/glass-tokens.css');
const tsx = source.filter((file) => file.endsWith('.tsx') && !relative(web, file).startsWith('src/components/glass/'));
let failed = false;
if (css.length) {
  const result = await stylelint.lint({ files: css, config: glassStylelintConfig });
  if (result.errored) {
    console.error(result.report);
    failed = true;
  }
}
if (tsx.length) {
  const eslint = new ESLint({
    cwd: web,
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const results = await eslint.lintFiles(tsx);
  if (results.some((result) => result.errorCount || result.fatalErrorCount)) {
    console.error(await (await eslint.loadFormatter('stylish')).format(results));
    failed = true;
  }
}
if (failed) process.exitCode = 1;
