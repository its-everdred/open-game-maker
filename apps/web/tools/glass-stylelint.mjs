import stylelint from 'stylelint';
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';
import { accentsInCss } from './glass-accents.mjs';

const accentRule = 'ogm/one-accent';
const localKit = resolve(process.cwd(), 'src/components/glass');
const kitDirectory = existsSync(localKit) ? localKit : resolve(process.cwd(), 'apps/web/src/components/glass');
const oneAccent = stylelint.createPlugin(accentRule, (enabled) => (root, result) => {
  if (!enabled) return;
  // The shared kit defines every supported tone; the rule applies to screens that use it.
  const file = root.source?.input.file;
  const kitRelative = file ? relative(kitDirectory, file) : undefined;
  if (kitRelative && !kitRelative.startsWith('..') && !isAbsolute(kitRelative)) return;
  const hues = new Set();
  let first;
  root.walkDecls((declaration) => {
    for (const accent of accentsInCss(declaration.value)) {
      hues.add(accent);
      first ??= declaration;
    }
  });
  if (hues.size > 1)
    stylelint.utils.report({
      ruleName: accentRule,
      result,
      node: first,
      message: `Use one interactive accent per screen; found ${[...hues].sort().join(', ')}.`,
    });
});

// Screen styling uses the generated design tokens, not locally invented values.
const literal = '/(?:#[\\da-f]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla)\\s*\\()/i';
const nonToken = '/^(?!\\s*(?:var\\(|(?:inherit|initial|unset|revert|none|normal|0)\\s*$))/i';
export const glassStylelintConfig = {
  plugins: [oneAccent],
  rules: {
    [accentRule]: true,
    'declaration-property-value-disallowed-list': {
      '/.*/': [literal],
      '/^border(?:-(?:top|bottom)-(?:left|right))?-radius$/': ['/\\b\\d*\\.?\\d+px\\b/i'],
      '/^(?:box-shadow|text-shadow|backdrop-filter|-webkit-backdrop-filter|font|font-size|font-weight|line-height|letter-spacing|transition-duration|transition-timing-function|animation-duration|animation-timing-function)$/':
        [nonToken, '/\\)\\s*,?\\s+[-+]?\\d*\\.?\\d+(?:px|rem|em|%|ms|s)?\\b/i'],
      '/^(?:transition|animation)$/': [
        '/\\b\\d*\\.?\\d+(?:ms|s)\\b/i',
        '/\\b(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|cubic-bezier|steps)\\b/i',
      ],
      opacity: [nonToken],
    },
  },
};
