// Screen styling uses the generated design tokens, not locally invented values.
const literal = '/(?:#[\\da-f]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla)\\s*\\()/i';
const nonToken = '/^(?!\\s*(?:var\\(|(?:inherit|initial|unset|revert|none|normal|0)\\s*$))/i';
export const glassStylelintConfig = {
  rules: {
    'declaration-property-value-disallowed-list': {
      '/.*/': [literal],
      '/^(?:border(?:-top|-right|-bottom|-left)?-radius)$/': ['/\\b\\d*\\.?\\d+px\\b/i'],
      '/^(?:box-shadow|text-shadow|backdrop-filter|-webkit-backdrop-filter|font|font-size|font-weight|line-height|letter-spacing|transition-duration|transition-timing-function|animation-duration|animation-timing-function)$/':
        [nonToken],
      '/^(?:transition|animation)$/': ['/\\b\\d*\\.?\\d+(?:ms|s)\\b/i'],
      opacity: [nonToken],
    },
  },
};
