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

it('rejects inline design values in template literals and permits static token references', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const [result] = await eslint.lintText(
    'const Screen = ({ size }) => <div style={{ color: `#fff`, borderRadius: `${size}px`, opacity: `var(--opacity)` }} />;',
    { filePath: 'src/Screen.tsx' },
  );
  expect(result!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(2);
}, 30_000);

it('rejects concatenated inline design values', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const [result] = await eslint.lintText(
    'const Screen = ({ size }) => <div style={{ color: "#" + "fff", borderRadius: size + "px" }} />;',
    { filePath: 'src/Screen.tsx' },
  );
  expect(result!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(2);
}, 30_000);

it('rejects raw inline design values in computed keys and object spreads', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const [result] = await eslint.lintText(
    'const Screen = () => <div style={{ ["color"]: "#fff", ...{ borderRadius: 8 }, ...{ opacity: "var(--opacity)" } }} />;',
    { filePath: 'src/Screen.tsx' },
  );
  expect(result!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(2);
}, 30_000);

it('rejects raw design values passed to shared component style props', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const [result] = await eslint.lintText(
    'const Screen = () => <GlassPanel style={{ color: "#fff", borderRadius: "var(--radius)" }} />;',
    { filePath: 'src/Screen.tsx' },
  );
  expect(result!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(1);
}, 30_000);

it('rejects unresolved expressions in inline design properties', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const [result] = await eslint.lintText(
    'const Screen = ({ colour, size }) => <div style={{ color: colour, borderRadius: Math.max(size, 2), top: size }} />;',
    { filePath: 'src/Screen.tsx' },
  );
  expect(result!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(2);
}, 30_000);

it('rejects uninspectable style objects while checking conditional inline styles', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const [result] = await eslint.lintText(
    'const Screen = ({ styles, key, active, x }) => <><div style={styles} /><div style={{ ...styles }} /><div style={{ [key]: "#fff" }} /><div style={active ? { color: "var(--ink)" } : { color: "#fff" }} /><div style={{ top: x }} /></>;',
    { filePath: 'src/Screen.tsx' },
  );
  expect(result!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(4);
}, 30_000);

it('checks statically spread JSX props and rejects unknown spreads', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const [result] = await eslint.lintText(
    'const Screen = ({ props }) => <><div {...{ role: "switch", className: "settings-panel", style: { color: "#fff" } }} /><div {...props} /><GlassPane {...{ style: { color: "var(--ink)" } }} /></>;',
    { filePath: 'src/Screen.tsx' },
  );
  expect(result!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(4);
}, 30_000);

it('rejects ad-hoc controls in conditional and template class names', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const [result] = await eslint.lintText(
    'const Screen = ({ open }) => <><div className={open ? "settings-panel" : "closed"} /><div className={`dialog-sheet ${open}`} /><div className={"body"} /></>;',
    { filePath: 'src/Screen.tsx' },
  );
  expect(result!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(2);
}, 30_000);

it('allows the shared Dialog primitive to declare its dialog role', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const code = 'const Panel = () => <><section role="dialog" /><div role="button" /></>;';
  const [primitive] = await eslint.lintText(code, { filePath: 'src/components/Dialog.tsx' });
  const [screen] = await eslint.lintText(code, { filePath: 'src/Screen.tsx' });
  const [nested] = await eslint.lintText(code, { filePath: 'src/other/src/components/Dialog.tsx' });
  expect(primitive!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(1);
  expect(screen!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(2);
  expect(nested!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(2);
}, 30_000);

it('rejects control roles selected conditionally', async () => {
  const eslint = new ESLint({
    overrideConfig: [
      { plugins: { glass: { rules: { components: glassComponentsRule } } }, rules: { 'glass/components': 'error' } },
    ],
  });
  const [result] = await eslint.lintText(
    'const Screen = ({ active }) => <><div role={active ? "switch" : "presentation"} /><div role="presentation" /></>;',
    { filePath: 'src/Screen.tsx' },
  );
  expect(result!.messages.filter((message) => message.ruleId === 'glass/components')).toHaveLength(1);
}, 30_000);
