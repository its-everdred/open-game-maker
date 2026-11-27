import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import { expect, it } from 'vitest';
import { glassComponentsRule } from '../../tools/glass-eslint.mjs';
import { glassStylelintConfig } from '../../tools/glass-stylelint.mjs';

it('rejects literal design values and accepts generated token references', async () => {
  for (const css of [
    '.a { color: #fff }',
    '.a { background: rgb(1 2 3) }',
    '.a { border-radius: 8px }',
    '.a { border-top-left-radius: 8px }',
    '.a { box-shadow: 0 2px black }',
    '.a { box-shadow: var(--shadow), 0 2px black }',
    '.a { font-size: 16px }',
    '.a { transition: opacity 200ms }',
    '.a { transition: opacity var(--duration) ease-in }',
    '.a { opacity: .5 }',
  ]) {
    expect((await stylelint.lint({ code: css, config: glassStylelintConfig })).errored, css).toBe(true);
  }
  expect(
    (
      await stylelint.lint({
        code: '.a { color: var(--ink); border-radius: var(--radius); opacity: var(--opacity) }',
        config: glassStylelintConfig,
      })
    ).errored,
  ).toBe(false);
}, 30_000);

it('rejects ad-hoc native controls in screens', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const results = await eslint.lintText(
    'const Screen = () => <><button /><input /><div className="settings-panel" /><div role="switch" /><GlassButton /></>;',
    {
      filePath: 'src/Screen.tsx',
    },
  );
  expect(results[0]!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(4);
}, 30_000);

it('rejects literal inline design values while accepting tokens', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const results = await eslint.lintText(
    "const Screen = () => <div style={{ borderRadius: 8, color: 'var(--ink)', opacity: 0.5 }} />;",
    { filePath: 'src/Screen.tsx' },
  );
  expect(results[0]!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(2);
}, 30_000);

it('rejects raw inline values hidden in conditional and mixed-token expressions', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const [result] = await eslint.lintText(
    "const Screen = ({ active }) => <div style={{ color: active ? 'var(--ink)' : '#fff', boxShadow: 'var(--shadow) 2px red', opacity: active && 0.5 }} />;",
    { filePath: 'src/Screen.tsx' },
  );
  expect(result!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(3);
}, 30_000);
